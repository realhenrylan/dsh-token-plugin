/**
 * dsh-usage-plugin — 五家官方来源适配层（读取 + 解析 → 目录来源块）。
 *
 * 每个来源独立：`fetchRaw` 只访问预设官方域名，`parse` 只做确定性转换。
 * 解析失败 / 结构异常一律 `{ ok:false }`，缓存层会保留上一次有效价格。
 *
 * 解析输入两种：
 *   1. 结构化样本（`*.sample.json`，第一阶段人工核验产物，可单测）；
 *   2. 官方页面/Markdown 原文（仅对已实测结构稳定的来源启用文本解析，
 *      其余来源解析失败即报"解析器失配"，绝不猜行）。
 *
 * @module dsh-usage-plugin/pricing/sources
 */

import {
  buildSourceBlock,
  normalizeEffective,
  fetchSource,
  tableRows,
  splitRowCells,
  stripTags,
  extractMoney
} from './common.js'
import { holidayRule } from '../holidays.js'

// ── 公共：样本 → 目录条目 ─────────────────────────────────────────────────

const BUCKET_KEYS = {
  input: ['input', 'inputCacheMiss', 'cacheMiss', 'miss', 'promptTokens'],
  cacheRead: ['cachedInput', 'cacheRead', 'inputCacheHit', 'cacheHit', 'hit'],
  cacheWrite: ['cacheWrite', 'cacheCreation', 'cacheWriteInput'],
  output: ['output', 'completion', 'outputTokens']
}

function pickKey(obj, names) {
  if (!obj || typeof obj !== 'object') return undefined
  for (const n of names) {
    if (n in obj) return obj[n]
  }
  return undefined
}

const isMoney = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** 把样本的 buckets（含峰谷 / TTL 特殊形状）归一成价格行或峰谷 windows。 */
function normalizeBuckets(raw) {
  const out = { prices: {}, windows: null, ttlWrite: null, missingBuckets: [] }
  if (!raw || typeof raw !== 'object') return out
  const flat = {}
  const perWindow = { offPeak: {}, peak: {} }
  let hasWindows = false
  for (const key of ['input', 'cacheRead', 'cacheWrite', 'output']) {
    const v = pickKey(raw, BUCKET_KEYS[key])
    if (v === undefined || v === null) {
      out.prices[key] = null
      if (key !== 'cacheWrite') out.missingBuckets.push(key)
      continue
    }
    if (isMoney(v)) {
      flat[key] = v
      continue
    }
    if (typeof v === 'object') {
      if (isMoney(v.offPeak) && isMoney(v.peak)) {
        hasWindows = true
        perWindow.offPeak[key] = v.offPeak
        perWindow.peak[key] = v.peak
        continue
      }
      // TTL 分档（Kimi 缓存写入 5m / 1h）
      const ttl = {}
      for (const [tk, tv] of Object.entries(v)) if (isMoney(tv)) ttl[tk] = tv
      if (Object.keys(ttl).length > 0) {
        out.ttlWrite = ttl
        flat[key] = ttl
        continue
      }
    }
    out.prices[key] = null
    out.missingBuckets.push(key)
  }
  if (hasWindows) {
    out.windows = [
      { id: 'offPeak', prices: { ...flat, ...perWindow.offPeak } },
      { id: 'peak', prices: { ...flat, ...perWindow.peak } }
    ]
    out.prices = { ...flat, ...perWindow.offPeak }
  } else {
    out.prices = { ...out.prices, ...flat }
  }
  return out
}

/** 别名归一：字符串 / {id} / {modelId} 三种形状都接受，统一 { id, scope }。 */
function aliasList(raw) {
  const out = []
  for (const a of Array.isArray(raw) ? raw : []) {
    if (typeof a === 'string') {
      if (a.trim()) out.push({ id: a.trim(), scope: ['*'] })
    } else if (a && typeof a === 'object') {
      const id = a.id || a.modelId
      if (id) out.push({ id: String(id).trim(), scope: Array.isArray(a.scope) && a.scope.length ? a.scope.map(String) : ['*'] })
    }
  }
  return out
}

function hasKey(obj, names) {
  return pickKey(obj, names) !== undefined
}

/**
 * DeepSeek 历史价段（仅用于历史参考金额，一律 verified=false）。
 *
 * 数值来自本插件历史实现里的官方公告核验（2026-08-17 第一版峰谷价、更早的
 * 基础价）；2026-11-01 复核时官方页面只保留现行价，旧价段仅存公告配图、
 * 不可再核验（见 docs/source-verification/deepseek.zh-CN.md 的缺口清单）。
 */
const DEEPSEEK_HISTORY = {
  'deepseek-flash': [
    {
      id: 'peakValley20260817',
      validFrom: Date.parse('2026-08-17T00:00:00+08:00'),
      validTo: Date.parse('2026-09-10T12:00:00+08:00'),
      windows: [
        { id: 'offPeak', prices: { cacheRead: 0.05, input: 1.5, output: 4.5 } },
        { id: 'peak', prices: { cacheRead: 0.1, input: 3, output: 9 } }
      ]
    },
    {
      id: 'baseBefore20260817',
      validFrom: null,
      validTo: Date.parse('2026-08-17T00:00:00+08:00'),
      prices: { cacheRead: 0.02, input: 1, output: 2 }
    }
  ],
  'deepseek-v4-pro': [
    {
      id: 'peakValley20260817',
      validFrom: Date.parse('2026-08-17T00:00:00+08:00'),
      validTo: Date.parse('2026-09-10T12:00:00+08:00'),
      windows: [
        { id: 'offPeak', prices: { cacheRead: 0.15, input: 4.5, output: 13.5 } },
        { id: 'peak', prices: { cacheRead: 0.3, input: 9, output: 27 } }
      ]
    },
    {
      id: 'baseBefore20260817',
      validFrom: null,
      validTo: Date.parse('2026-08-17T00:00:00+08:00'),
      prices: { cacheRead: 0.025, input: 3, output: 6 }
    }
  ]
}

/**
 * 通用样本模型 → 目录条目。
 *
 * 不做补值：样本缺什么，条目就带 missing 什么（completeness='partial'）。
 */
function normalizeSampleModel(model, payload) {
  if (!model || typeof model !== 'object') return null
  const officialModelId = String(model.officialModelId || '').trim()
  if (!officialModelId) return null
  const unit = String(model.unit || 'per_1m_tokens')
  const currency = String(model.currency || payload.currency || 'CNY')
  const notes = []
  const missing = []
  const eff = normalizeEffective(model.effectiveFrom, model.effectiveTo)
  if (!eff.known) missing.push('effective_date')

  const entry = {
    sourceId: payload.sourceId,
    sourceUrl: payload.sourceUrl,
    officialModelId,
    aliases: aliasList(model.aliases),
    currency,
    unit,
    region: String(model.region || (payload.region || (payload.sourceId === 'qwen' ? 'cn-beijing' : 'cn'))),
    cache: { readFallbackToInput: false, writeBilledAs: 'unknown' },
    periods: null,
    tiers: [],
    effective: eff,
    fetchedAt: Date.parse(payload.fetchedAt) || Date.now(),
    completeness: 'full',
    missing: [],
    notes
  }

  // 非 token 计价项（音频时长、按次等）：单价与用量语义不可核实 → 不套文本公式。
  if (unit !== 'per_1m_tokens' && unit !== 'per_1k_tokens') {
    entry.pricingExcluded = true
    entry.bucketSemantics = 'unsplit'
    entry.tiers = [{ id: 'excluded', prices: {} }]
    missing.push('non_token_unit')
    notes.push('非 token 计价项（' + unit + '），插件无对应用量，未覆盖')
    entry.missing = Array.from(new Set(missing))
    entry.completeness = 'partial'
    return entry
  }

  // 只有一个"未分桶"单价（如 GLM-4-Voice / Embedding）：分桶语义不明确。
  if (model.unsplitTokenRate != null || (Array.isArray(model.inputModalities) && model.inputModalities.length === 1 && model.inputModalities[0] === 'audio')) {
    entry.bucketSemantics = 'unsplit'
    missing.push('bucket_semantics')
    notes.push('官方单价未区分输入/输出桶或按音频时长计价，分桶语义不明确，不自动计价')
  }
  if (model.idEvidence === 'pricing_display_name_only') missing.push('official_model_id_evidence')
  if (model.completeness === 'partial' && missing.length === 0) missing.push('official_completeness_partial')
  if (model.note) notes.push(String(model.note))

  // 缓存规则
  const cache = model.cache || null
  const cacheTtl = model.cacheTtl || null
  if (cache && cache.write === 'free_limited_time') {
    entry.cache.writeBilledAs = 'separate'
    notes.push('缓存写入限时免费（官方未公布截止日期）')
  }
  if (cacheTtl && cacheTtl.default) entry.cache.writeTtlDefault = String(cacheTtl.default)

  // 分档：GLM 风格 tiers 或单档 buckets / batchBuckets
  const tierShapes = []
  const thinkingSplit = !!(model.thinking && model.thinking.separatelyPriced === true)
  if (Array.isArray(model.tiers) && model.tiers.length > 0) {
    for (const t of model.tiers) {
      const b = normalizeBuckets(t.buckets)
      const base = {
        id: String(t.label || t.maxInputTokens || 'tier'),
        maxInputTokens: Number.isInteger(t.maxInputTokens) && t.maxInputTokens > 0 ? t.maxInputTokens : null,
        maxOutputTokens: Number.isInteger(t.maxOutputTokens) && t.maxOutputTokens > 0 ? t.maxOutputTokens : null,
        prices: b.prices,
        windows: b.windows
      }
      if (thinkingSplit) {
        // 思考 / 非思考分开计价（如 qwen-plus）：模式未知时不猜档。
        tierShapes.push({ ...base, id: base.id + ':standard', mode: 'standard' })
        tierShapes.push({
          ...base,
          id: base.id + ':thinking',
          mode: 'thinking',
          prices: { ...b.prices, output: isMoney(t.thinkingOutput) ? t.thinkingOutput : null }
        })
        if (!isMoney(t.thinkingOutput)) missing.push('thinkingOutput')
      } else {
        tierShapes.push(base)
      }
      for (const k of b.missingBuckets) missing.push(k)
    }
  } else {
    const b = normalizeBuckets(model.buckets)
    const base = { id: 'standard', maxInputTokens: null, maxOutputTokens: null, prices: b.prices, windows: b.windows }
    if (model.effectiveFrom) base.validFrom = eff.from
    if (model.effectiveTo) base.validTo = eff.to
    tierShapes.push(base)
    const batch = model.batchBuckets || (model.batch && model.batch.supported === true && model.batch.input != null ? model.batch : null)
    if (batch && typeof batch === 'object') {
      const bb = normalizeBuckets(batch)
      if (Object.values(bb.prices).some((v) => isMoney(v) || (v && typeof v === 'object'))) {
        tierShapes.push({ id: 'batch', mode: 'batch', maxInputTokens: null, maxOutputTokens: null, prices: bb.prices, windows: bb.windows })
      }
    }
    for (const k of b.missingBuckets) missing.push(k)
    // Kimi 缓存写入按 TTL 一次性收费：把分档价挂到 cacheWrite，由引擎按
    // 官方默认 TTL 档取价并标注假设。
    if (b.ttlWrite && cacheTtl && cacheTtl.default) {
      const want = String(cacheTtl.default)
      const defKey = [want, 'ttl' + want, want.replace(/^ttl/i, 'ttl')].find((k) => k in b.ttlWrite) || null
      if (defKey) entry.cache.writeTtlDefault = defKey
      for (const t of tierShapes) {
        if (t.prices && t.prices.cacheWrite == null) t.prices.cacheWrite = b.ttlWrite
      }
    }
  }
  if (tierShapes.length === 0) tierShapes.push({ id: 'no-price', maxInputTokens: null, maxOutputTokens: null, prices: {} })
  if (Array.isArray(model.missing)) missing.push(...model.missing.map(String))
  // 官方明示"不支持缓存"的型号：缓存命中 / 写入按普通输入价计（无缓存折扣），
  // 不算缺价；官方"支持缓存但未给命中价"的型号仍按缺价处理，不猜折扣率。
  if (model.cache && model.cache.supported === false) {
    entry.cache.readFallbackToInput = true
    entry.cache.writeBilledAs = 'miss'
    const drop = new Set(['cacheRead', 'cacheWrite'])
    for (let i = missing.length - 1; i >= 0; i--) if (drop.has(missing[i])) missing.splice(i, 1)
    notes.push('官方未将该型号列入缓存支持列表：缓存命中/写入按普通输入价计')
  }
  entry.tiers = tierShapes
  // 缓存写入限时免费（官方明示 0 价）：显式写 0，不留给"缺价"。
  if (cache && cache.write === 'free_limited_time') {
    entry.cache.writeBilledAs = 'separate'
    for (const t of entry.tiers) {
      if (t.prices && t.prices.cacheWrite == null) t.prices.cacheWrite = 0
      if (t.windows) for (const w of t.windows) if (w.prices.cacheWrite == null) w.prices.cacheWrite = 0
    }
  }
  // DeepSeek 历史价段：现行核验只能确认 2026-09-10 12:00 起的价；更早的两段
  // 仅存在于插件历史实现（当时核验的官方公告），标注 verified=false 让金额可追溯
  // 为"未复核历史价"，绝不冒充现行官方价。
  if (payload.sourceId === 'deepseek' && Array.isArray(tierShapes)) {
    const hist = DEEPSEEK_HISTORY[officialModelId] || []
    for (const era of hist) {
      entry.tiers.push({
        id: era.id,
        verified: false,
        validFrom: era.validFrom,
        validTo: era.validTo,
        maxInputTokens: null,
        maxOutputTokens: null,
        prices: era.prices || {},
        windows: era.windows || null
      })
    }
  }
  if (entry.tiers.some((t) => t.windows)) {
    entry.periods = defaultPeakValleyPeriods()
    for (const t of entry.tiers) {
      if (!t.windows) continue
      if (!t.validFrom && eff.known) t.validFrom = eff.from
    }
  }
  entry.missing = Array.from(new Set(missing))
  entry.completeness = entry.missing.length > 0 ? 'partial' : (model.completeness === 'partial' ? 'partial' : 'full')
  if (entry.completeness === 'partial' && entry.missing.length === 0) entry.missing.push('official_completeness_partial')
  return entry
}

/**
 * DeepSeek 峰谷规则（官方价目 + 外部节假日日历）。
 *
 * 官方现行文本（2026-11-01 核验）：北京时间周一至周五（不含中国法定节假日）
 * 9:00–12:00、14:00–18:00 为高峰，其余时间含周末与法定节假日全天空闲。
 * 「官方价参考金额」按这条现行规则回算；插件旧口径的历史冻结单价不受影响
 * （旧实现为避免改写历史账单，把周末 / 节假日规则设过分段生效时刻）。
 */
function defaultPeakValleyPeriods() {
  return {
    kind: 'peak-valley',
    timeZone: 'Asia/Shanghai',
    peakWindows: [[9 * 60, 12 * 60], [14 * 60, 18 * 60]],
    weekendFlatFrom: 0,
    holidayFlatFrom: 0,
    holidays: holidayRule(),
    crossPeriodSettlement: 'unknown'
  }
}

// ── 文本解析（仅对结构已实测的来源启用） ─────────────────────────────────

/** MiMo 价格 Markdown/HTML：`模型名` 行 + 3 个金额（命中 / 未命中 / 输出）。 */
function parseMimoText(body, payload) {
  const rows = tableRows(body)
  const seen = new Map()
  const models = []
  for (const row of rows) {
    const id = row.ids.find((x) => /^mimo-v\d/i.test(x))
    if (!id) continue
    const nums = row.numbers.slice(-3)
    if (nums.length < 3) continue
    const label = row.cells.join(' ')
    // 官方文档同一型号有 4 张表：人民币实时、人民币 Batch、美元实时、美元 Batch。
    // 目录只收人民币价；美元表不能当 Batch 价，否则金额会被按 USD 数值记成 CNY。
    if (!/[¥￥]/.test(label)) continue
    const key = id.toLowerCase()
    const count = (seen.get(key) || 0) + 1
    seen.set(key, count)
    const isBatch = count > 1
    if (!isBatch) {
      models.push({
        officialModelId: key,
        aliases: [],
        currency: 'CNY',
        unit: 'per_1m_tokens',
        buckets: { inputCacheHit: nums[0], inputCacheMiss: nums[1], output: nums[2] },
        cache: { write: 'free_limited_time' },
        effectiveFrom: '2026-05-27T00:00:00+08:00',
        completeness: 'partial'
      })
    } else {
      const m = models.find((x) => x.officialModelId === key)
      if (m) m.batchBuckets = { inputCacheHit: nums[0], inputCacheMiss: nums[1], output: nums[2] }
    }
  }
  if (models.length === 0) return { ok: false, error: 'MiMo 价格表解析失配（未找到型号行），保留上一次有效价格' }
  return buildSourceBlock({ ...payload, ok: true, models }, normalizeSampleModel)
}

/** DeepSeek 价格 Markdown：按「价格(2) | 百万tokens…| 空闲/高峰时段 | 价 | 价」行解析。 */
function parseDeepseekText(body, payload) {
  const rows = tableRows(body)
  const priceRows = []
  for (const row of rows) {
    const label = row.cells.join(' ')
    if (label.indexOf('价格') < 0) continue
    const bucket = label.indexOf('缓存命中') >= 0 ? 'cacheHit'
      : label.indexOf('缓存未命中') >= 0 ? 'cacheMiss'
        : label.indexOf('输出') >= 0 ? 'output' : null
    if (!bucket) continue
    const window = label.indexOf('高峰') >= 0 ? 'peak' : label.indexOf('空闲') >= 0 ? 'offPeak' : null
    if (!window) continue
    const nums = row.numbers
    if (nums.length < 2) continue
    priceRows.push({ bucket, window, values: nums.slice(-2) })
  }
  if (priceRows.length !== 6) {
    return { ok: false, error: 'DeepSeek 价格表解析失配（识别到 ' + priceRows.length + ' 行价格，预期 6 行），保留上一次有效价格' }
  }
  const names = ['deepseek-flash', 'deepseek-v4-pro']
  const models = names.map((name, col) => {
    const buckets = {}
    for (const { bucket, window, values } of priceRows) {
      buckets[bucket] = buckets[bucket] || {}
      buckets[bucket][window] = values[col]
    }
    return {
      officialModelId: name,
      aliases: name === 'deepseek-flash'
        ? ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']
        : [],
      currency: 'CNY',
      unit: 'per_1m_tokens',
      buckets,
      effectiveFrom: '2026-09-10T12:00:00+08:00',
      completeness: 'full'
    }
  })
  return buildSourceBlock({ ...payload, ok: true, models }, normalizeSampleModel)
}

// ── GLM 定价页 Markdown（docs.bigmodel.cn `.md` 镜像） ─────────────────────
//
// 输入：https://docs.bigmodel.cn/cn/guide/start/pricing.md（Mintlify 镜像，表格
// 即价格表）。列头：模型名称 | 上下文 | 输入单价（元/百万 Tokens） | 输出单价（元/
// 百万 Tokens） | 缓存存储（元/百万 Tokens/小时） | 缓存命中（元/百万 Tokens） |
// 输入模态（部分表无此列）。折叠区（> [accordion]）行首带 `> ` 前缀，去掉即同表。
// 语义（2026-11-01 核验）：数字=元/百万、`免费`=0、`不支持`=缓存不支持（null≠0）、
// `限时免费`=存储 0；上下文格纯数字串（1M/128K/…/—）=单档无阶梯，区间文本=分档，
// K=1000、M=1000000（官方口径）。按次/按分钟/按字符表不套 token 公式，只计数。
function glmKTokens(text) {
  const m = /^([0-9]+(?:\.[0-9]+)?)([KM]?)$/.exec(String(text || '').trim())
  if (!m) return null
  return Math.round(Number(m[1]) * (m[2] === 'K' ? 1000 : m[2] === 'M' ? 1000000 : 1))
}

/** GLM 上下文格 → tier 边界（label 保留原文）。无法识别返回 null（宁可失配不猜）。
 * 语义：`输入 [0, 32K)，输出 [0, 0.2K)` → maxInput 32000 / maxOutput 200；
 * `输出 ≥0.2K` 是下界 → 无输出上界（null）；`输入长度 ≥32K` 同理无输入上界。 */
function glmTierBounds(text) {
  const label = String(text || '').trim()
  const t = label.replace(/\\/g, '').replace(/\s/g, '')
  if (!t || t === '—' || t === '-') return { maxInputTokens: null, maxOutputTokens: null, label }
  if (/无阶梯/.test(t)) return { maxInputTokens: null, maxOutputTokens: null, label }
  const hasIn = t.indexOf('输入') >= 0
  const hasOut = t.indexOf('输出') >= 0
  if (!hasIn && !hasOut) {
    if (/^[0-9.]+[KM]?$/.test(t)) return { maxInputTokens: null, maxOutputTokens: null, label }
    return null
  }
  const outIdx = t.indexOf('输出')
  const inSeg = hasIn ? t.slice(t.indexOf('输入'), hasOut ? outIdx : undefined) : ''
  const outSeg = hasOut ? t.slice(outIdx) : ''
  const upperBound = (seg) => {
    if (!seg || /≥|>=/.test(seg)) return null
    const m = /\[[0-9.]+[KM]?,([0-9.]+[KM]?)\)?/.exec(seg)
    return m ? glmKTokens(m[1]) : null
  }
  return {
    maxInputTokens: hasIn ? upperBound(inSeg) : null,
    maxOutputTokens: hasOut ? upperBound(outSeg) : null,
    label
  }
}

/** GLM 价格格语义：数字 / 免费(0) / 不支持(null) / 限时免费(0)；其他文本→null（不是价格格）。 */
function glmPriceCell(text) {
  const t = String(text || '').trim()
  if (t === '免费') return { value: 0, kind: 'free' }
  if (t === '限时免费') return { value: 0, kind: 'free_limited_time' }
  if (t === '不支持') return { value: null, kind: 'unsupported' }
  if (t === '—' || t === '-' || t === '') return { value: null, kind: 'none' }
  const m = /^([0-9]+(?:\.[0-9]+)?)(?:\s*元.*)?$/.exec(t)
  if (m) return { value: Number(m[1]), kind: 'number' }
  return null
}

function glmSplitRowCells(line) {
  return String(line || '').replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => stripTags(c).replace(/\\/g, '').trim())
}

function parseGlmText(body, payload) {
  const lines = String(body || '').split('\n').map((l) => l.replace(/^>\s?/, ''))
  const models = new Map()
  const nonToken = []
  let section = ''
  let header = null
  const flushHeader = () => { header = null }
  for (const raw of lines) {
    const line = raw.trim()
    if (/^#{2,4}\s/.test(line)) {
      section = line.replace(/^#+\s*/, '')
      flushHeader()
      continue
    }
    if (line.indexOf('|') < 0) continue
    const cells = glmSplitRowCells(line)
    if (cells.length < 3) continue
    if (cells.every((c) => /^-{2,}$/.test(c) || c === '')) continue
    if (cells[0] === '模型名称' || cells[0] === '工具名称' || cells[0] === '功能') {
      header = { first: cells[0], cells }
      continue
    }
    if (!header) continue
    const name = cells[0]
    if (!name) continue
    // 表格分隔行（| - | - |…）与无字母数字的伪名称一律跳过
    if (!/[A-Za-z0-9]/.test(name)) continue
    if (header.first === '工具名称' || header.first === '功能') {
      nonToken.push({ name, section })
      continue
    }
    const head = header.cells
    const isTokenTable = head[1] === '上下文' && head.length >= 6
    const isUnsplitToken = head.length >= 4 && /单价（元\/百万/.test(head.join('|'))
    const isPerCallTable = head.indexOf('单价') >= 0 && !isTokenTable && !isUnsplitToken
    if (isTokenTable) {
      // 6/7 列：名称|上下文|输入|输出|缓存存储|缓存命中|输入模态
      const bounds = glmTierBounds(cells[1])
      if (!bounds) continue
      const input = glmPriceCell(cells[2])
      const output = glmPriceCell(cells[3])
      const storage = glmPriceCell(cells[4])
      const cacheHit = glmPriceCell(cells[5])
      if (!input || !output) continue
      const modality = cells[6] || (/视觉/.test(section) ? '文本、图片' : '文本')
      const model = models.get(name) || {
        officialModelId: name,
        aliases: [],
        currency: 'CNY',
        unit: 'per_1m_tokens',
        tiers: [],
        inputModalities: modality.split(/[、,，]/).map((s) => (s.indexOf('图') >= 0 ? 'image' : s.indexOf('视') >= 0 ? 'video' : s.indexOf('文') >= 0 ? 'text' : s.indexOf('音') >= 0 ? 'audio' : s.trim())).filter(Boolean),
        effectiveFrom: null,
        completeness: 'full'
      }
      model.tiers.push({
        label: bounds.label,
        maxInputTokens: bounds.maxInputTokens,
        maxOutputTokens: bounds.maxOutputTokens,
        buckets: {
          input: input.value,
          cachedInput: cacheHit.value,
          output: output.value
        }
      })
      if (storage.kind === 'free_limited_time') {
        model.cache = { write: 'free_limited_time' }
        model.cacheStorage = { status: 'limited_time_free', pricePer1mTokensPerHour: 0, postPromoPrice: null }
      }
      if (cacheHit.kind === 'unsupported') {
        model.note = '缓存命中官方标注『不支持』，cachedInput=null 表示不支持缓存计价（非免费）'
      }
      models.set(name, model)
      continue
    }
    if (isUnsplitToken) {
      // 向量/其他：名称|简介|上下文长度|单价（元/百万 Tokens）|Batch API 定价?
      const rate = glmPriceCell(cells[head.indexOf('单价（元/百万 Tokens）')] || cells[3])
      if (!rate || rate.value == null) continue
      const batchIdx = head.findIndex((h) => /Batch/.test(h))
      const batchRate = batchIdx >= 0 ? glmPriceCell(cells[batchIdx]) : null
      const labelPrefix = (cells[2] || cells[1] || '').trim()
      const label = labelPrefix ? labelPrefix + '，单价 ' + rate.value + (batchRate && batchRate.value != null ? '；Batch API ' + batchRate.value : '') : String(rate.value)
      models.set(name, {
        officialModelId: name,
        aliases: [],
        currency: 'CNY',
        unit: 'per_1m_tokens',
        unsplitTokenRate: rate.value,
        unsplitBatchRate: batchRate && batchRate.value != null ? batchRate.value : undefined,
        tiers: [{ label, buckets: { input: null, cachedInput: null, output: null } }],
        effectiveFrom: null,
        completeness: 'full'
      })
      continue
    }
    // 语音表：名称|简介|支持模态|单价 —— 逐格判定 token 单价 / 按次 / 按字符
    const priceCell = cells[3] || ''
    const asrM = /输入：\s*([0-9.]+)\s*元\/百万/.exec(priceCell)
    if (asrM && /不计费|输出：\s*0/.test(priceCell)) {
      models.set(name, {
        officialModelId: name,
        aliases: [],
        currency: 'CNY',
        unit: 'per_1m_tokens',
        tiers: [{ label: priceCell, buckets: { input: Number(asrM[1]), cachedInput: null, output: 0 } }],
        inputModalities: ['audio'],
        cacheStorage: null,
        effectiveFrom: null,
        completeness: 'full'
      })
      continue
    }
    const voiceM = /^([0-9.]+)\s*元\/百万\s*Tokens?$/.exec(priceCell.trim())
    if (voiceM) {
      models.set(name, {
        officialModelId: name,
        aliases: [],
        currency: 'CNY',
        unit: 'per_1m_tokens',
        unsplitTokenRate: Number(voiceM[1]),
        tiers: [{ label: priceCell.trim(), buckets: { input: null, cachedInput: null, output: null } }],
        inputModalities: (cells[2] || '文本').split(/[、,，]/).map((s) => (s.indexOf('音') >= 0 ? 'audio' : 'text')),
        note: '官方仅给单一单价，未区分输入/输出桶',
        effectiveFrom: null,
        completeness: 'full'
      })
      continue
    }
    nonToken.push({ name, section })
  }
  const list = Array.from(models.values())
  if (list.length === 0) return { ok: false, error: 'GLM 价格表解析失配（未识别到模型行），保留上一次有效价格' }
  const notes = []
  if (nonToken.length > 0) {
    notes.push('另有 ' + nonToken.length + ' 个按次 / 按分钟 / 按字符计价项（' + Array.from(new Set(nonToken.map((x) => x.section))).join('、') + '），不套 token 公式，未覆盖')
  }
  notes.push('缓存存储限时免费；免费期结束后的标准价格官方标注『本页暂不展示』，未猜测')
  return buildSourceBlock({ ...payload, ok: true, models: list, notes }, normalizeSampleModel)
}

// ── Kimi 定价页（platform.kimi.com，价格在页面 JS flight payload） ─────────
//
// 输入：https://platform.kimi.com/docs/pricing/chat + …/pricing/batch（两页都抓）。
// 页面为客户端渲染，单价只出现在 flight payload 的字符串数组里；行模式实测：
//   …children:`kimi-k3.1-pro`}),`¥13.00 / MTok`,`¥68.00 / MTok`,…`
// 价格格序列 = 输入 / 输出 / 缓存命中 / 缓存写入(5m) / 缓存写入(1h)；K2 系只有
// 3 格（不支持缓存写入）。批价页同构（60% 价，highspeed 不在批价表）。
function kimiPriceCells(text) {
  const out = []
  const re = /`¥([0-9.]+)\s*\/\s*MTok`/g
  let m
  while ((m = re.exec(text))) out.push(Number(m[1]))
  return out
}

function kimiRows(body) {
  const rows = new Map()
  const re = /children:`(kimi-[^`]+)`\}\),((?:`[^`]*`,?)+)/g
  let m
  while ((m = re.exec(String(body || '')))) {
    const id = m[1].trim()
    const prices = kimiPriceCells(m[2])
    if (prices.length < 3) continue
    rows.set(id.toLowerCase(), { id, prices })
  }
  return rows
}

function kimiBucketModel(id, prices, contextWindow) {
  const model = {
    officialModelId: id,
    displayName: undefined,
    aliases: [],
    currency: 'CNY',
    unit: 'per_1m_tokens',
    contextWindow,
    buckets: {
      input: prices[0],
      cachedInput: prices[2],
      cacheWrite: prices.length >= 5 ? { ttl5m: prices[3], ttl1h: prices[4] } : null,
      output: prices[1]
    },
    cacheTtl: null,
    batch: null,
    effectiveFrom: null,
    completeness: 'full'
  }
  if (prices.length >= 5) {
    model.cacheTtl = {
      default: '5m',
      options: ['5m', '1h'],
      hitRenewsTtl: true,
      ttlLockedAtFirstWrite: true,
      storageFee: null
    }
  } else {
    model.cacheTtl = {
      default: null,
      options: null,
      hitRenewsTtl: true,
      ttlLockedAtFirstWrite: null,
      storageFee: null,
      note: '本次核验未能读取到 K2 系列 TTL 档位的官方明确说明；官方仅明确 K2 系列不支持缓存写入（Cache Write），缓存命中自动续期'
    }
    model.completeness = 'partial'
  }
  return model
}

function parseKimiText(body, payload, raw) {
  const pages = (raw && Array.isArray(raw.pages) && raw.pages.length > 0)
    ? raw.pages
    : [{ url: String((raw && raw.url) || ''), body }]
  const chatPage = pages.find((p) => /\/chat/.test(p.url)) || pages[0]
  const batchPage = pages.find((p) => /\/batch/.test(p.url))
  // 页面身份守卫（不产伪精确金额）：批价页行形态与实时价表同构，若误把批量定价页
  // 当实时价页解析会把 6 折批价当实时价。判别标记：实时价页含「不指定 TTL 时默认按
  // 此档」（TTL 说明），批量定价页含「标准模型价格的 60%」。两者都缺失=页面改版，
  // 交给下方行提取失配兜底；只命中批价标记=身份错配，直接拒收保留上一次有效价格。
  const chatNorm = stripTags(String(chatPage.body || '')).replace(/\s+/g, '')
  const looksLikeBatchPage = chatNorm.includes('标准模型价格的60%') && !chatNorm.includes('不指定TTL时默认按此档')
  if (looksLikeBatchPage) {
    return { ok: false, error: 'Kimi 页面身份不匹配（实时价入口拿到批量定价页内容，批价不可当实时价），保留上一次有效价格' }
  }
  const chatRows = kimiRows(chatPage.body)
  if (chatRows.size === 0) return { ok: false, error: 'Kimi 价格表解析失配（flight payload 未找到型号行），保留上一次有效价格' }
  if (batchPage) {
    const batchNorm = stripTags(String(batchPage.body || '')).replace(/\s+/g, '')
    if (batchNorm.includes('不指定TTL时默认按此档') && !batchNorm.includes('标准模型价格的60%')) {
      return { ok: false, error: 'Kimi 页面身份不匹配（批价入口拿到实时价页内容），保留上一次有效价格' }
    }
  }
  const batchRows = batchPage ? kimiRows(batchPage.body) : new Map()
  // 上下文窗口（页面正文）：「kimi-k3.1-pro、kimi-k3 的上下文窗口为 1,048,576 tokens」
  const windows = new Map()
  const winRe = /((?:kimi-[\w.-]+)(?:、kimi-[\w.-]+)*)\s*的上下文窗口为\s*([0-9,]+)\s*tokens/g
  let wm
  while ((wm = winRe.exec(String(chatPage.body || '')))) {
    for (const id of wm[1].split('、')) windows.set(id.trim().toLowerCase(), Number(wm[2].replace(/,/g, '')))
  }
  const models = []
  for (const { id, prices } of chatRows.values()) {
    const model = kimiBucketModel(id, prices, windows.get(id.toLowerCase()) || null)
    const b = batchRows.get(id.toLowerCase())
    if (b) {
      model.batch = {
        supported: true,
        input: b.prices[0],
        output: b.prices[1],
        cachedInput: b.prices[2],
        cacheWrite: b.prices.length >= 5 ? { ttl5m: b.prices[3], ttl1h: b.prices[4] } : null
      }
    }
    models.push(model)
  }
  const notes = ['批价来自批量推理定价页（' + (batchPage ? batchPage.url : '未抓到') + '）；批量推理按标准价 60% 计费']
  return buildSourceBlock({ ...payload, ok: true, models, notes }, normalizeSampleModel)
}

// ── Qwen（百炼）价格页 SSR HTML ─────────────────────────────────────────
//
// 输入：https://help.aliyun.com/zh/model-studio/model-pricing（SSR HTML，同一内容
// 存在转义+渲染两份，需去重）+ https://help.aliyun.com/zh/model-studio/context-cache
// （上下文缓存支持清单与例外说明）。行形态实测（2026-11-01）：
//   ① 带「模式」格：[模式, 条件, 输入, 输出, 免费额度]（qwen3.8 系 / flash 系）
//   ② 无模式格：  [条件, 输入, 非思考输出, 思考输出, 免费额度]（qwen3.6/3.5/plus 系）
//   海外分区行首多一个「服务部署范围」格且价格不同 → 本解析器只收北京分区行。
//   阶梯续行首格是条件文本（如 256K<Token≤1M），免费额度格 rowspan 不在续行。
// 缓存规则（2026-11-01 核验，来源 https://help.aliyun.com/zh/model-studio/context-cache）：
//   显式创建 = 输入单价 125%、命中 = 10%；隐式创建 = 100%、命中 = 20%；最少 1024
//   Token；显式有效期 5 分钟。例外型号（命中价不适用 10%、公开页无数值）：
//   qwen3.8-max、qwen3.8-max-0902、qwen3.8-2.4t-a95b（创建仍 125%）；
//   qwen3.8-flash（创建与命中都不适用，且随地域不同）。
const QWEN_CACHE_URL = 'https://help.aliyun.com/zh/model-studio/context-cache'
const QWEN_CACHE_RATIOS = { write: 1.25, hit: 0.1, implicitHit: 0.2, minTokens: 1024, ttlSeconds: 300 }
const QWEN_CACHE_EXCEPTIONS = new Set(['qwen3.8-max', 'qwen3.8-max-0902', 'qwen3.8-2.4t-a95b', 'qwen3.8-flash'])
const QWEN_FLASH_EXACT = 'qwen3.8-flash'

function qwenUnescape(raw) {
  return String(raw || '')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\\//g, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function qwenCellParagraphs(html) {
  const out = []
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m
  while ((m = re.exec(html))) {
    const t = stripTags(m[1]).trim()
    if (t) out.push(t)
  }
  if (out.length === 0) {
    const t = stripTags(html).trim()
    if (t) out.push(t)
  }
  return out
}

function qwenRowCells(rowHtml) {
  const out = []
  const re = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi
  let m
  while ((m = re.exec(rowHtml))) out.push({ tag: m[1].toLowerCase(), paragraphs: qwenCellParagraphs(m[2]) })
  return out
}

function qwenPrice(text) {
  const t = String(text || '').trim()
  if (t === '免费') return { value: 0, discount: false }
  if (t === '不支持' || t === '—' || t === '-' || t === '') return null
  const m = /^(?:原价)?\s*([0-9]+(?:\.[0-9]+)?)\s*元/.exec(t)
  if (!m) return null
  return { value: Number(m[1]), discount: t.indexOf('限时8折') >= 0 }
}

/** 条件格 → maxInputTokens（K=1000、M=1000000，取区间上界；无阶梯=null）。 */
function qwenTierCap(text) {
  const t = String(text || '').replace(/\s/g, '')
  if (t.indexOf('无阶梯') >= 0) return { maxInputTokens: null, label: t }
  const m = /[≤<]([0-9.]+)([KM]?)/.exec(t)
  if (!m) return null
  return {
    maxInputTokens: Math.round(Number(m[1]) * (m[2] === 'K' ? 1000 : m[2] === 'M' ? 1000000 : 1)),
    label: t
  }
}

/** 从 context-cache 页提取「支持的模型」北京（华北 2）小节的 qwen* ID 集合。
 * 页面有两处「支持的模型」：显式缓存清单（与计价口径一致）与隐式缓存清单（范围更宽）。
 * **只取第一个（显式缓存）清单**——qwen-max 等仅隐式支持，fixture 口径标 cache.supported=false（命中按输入价）。
 * 识别不到返回 null（调用方按失配处理，不猜）。 */
function qwenSupportIds(html) {
  const text = qwenUnescape(html)
  const idx = text.indexOf('id="支持的模型')
  if (idx < 0) return null
  const anchor = idx + 12
  const end = text.indexOf('<h3', anchor)
  const seg = text.slice(idx, end < 0 ? undefined : end)
  const ids = new Set()
  // 按 <h4> 切小节，只收含「北京」的小节
  const parts = seg.split(/<h4[^>]*>/)
  for (const part of parts) {
    const h4End = part.indexOf('</h4>')
    const heading = stripTags(h4End >= 0 ? part.slice(0, h4End) : '')
    if (!/北京/.test(heading)) continue
    const body = h4End >= 0 ? part.slice(h4End + 5) : part
    // 标签替换为空格再匹配，避免相邻 ID 被标签拼接（如 qwen-doc-turbokimi）
    for (const id of (body.replace(/<[^>]*>/g, ' ').match(/qwen[\w.-]*/gi) || [])) ids.add(id.toLowerCase())
  }
  return ids.size > 0 ? ids : null
}

function parseQwenText(body, payload, raw) {
  const pages = (raw && Array.isArray(raw.pages) && raw.pages.length > 0)
    ? raw.pages
    : [{ url: String((raw && raw.url) || ''), body }]
  const pricingPage = pages.find((p) => /model-pricing/.test(p.url)) || pages[0]
  const cachePage = pages.find((p) => /context-cache/.test(p.url))
  if (!cachePage) {
    return { ok: false, error: 'Qwen 缓存规则页（context-cache）读取缺失，无法确定上下文缓存支持范围，保留上一次有效价格' }
  }
  const support = qwenSupportIds(cachePage.body)
  if (!support) {
    return { ok: false, error: 'Qwen 缓存支持模型清单解析失配（context-cache 页面结构变化），保留上一次有效价格' }
  }
  const html = qwenUnescape(pricingPage.body)
  const rows = new Map()
  const order = []
  let region = ''
  const scanRe = /(<h4[^>]*>[\s\S]*?<\/h4>)|(<table[^>]*>[\s\S]*?<\/table>)/gi
  let sm
  while ((sm = scanRe.exec(html))) {
    if (sm[1]) {
      region = stripTags(sm[1].replace(/<[^>]*>/g, ' ')).trim()
      continue
    }
    if (region.indexOf('北京') < 0) continue
    const tableHtml = sm[2]
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let rm
    let prev = null
    while ((rm = rowRe.exec(tableHtml))) {
      const cells = qwenRowCells(rm[1])
      if (cells.length < 3) continue
      if (cells[0].tag === 'th') continue
      const name = cells[0].paragraphs[0] || ''
      if (!name) continue
      const isModelRow = /^qwen[\w.-]*$/i.test(name) && name.indexOf('/') < 0
      const isContRow = /Token|阶梯/.test(name) && !isModelRow
      if (!isModelRow && !isContRow) { prev = null; continue }
      if (isModelRow) {
        let rest = cells.slice(1)
        if (rest.length && /^(国际|全球|美国|新加坡|德国|日本|中国香港)/.test(rest[0].paragraphs[0] || '')) rest = rest.slice(1)
        let mode = null
        let cond = ''
        let priceCells = []
        if (rest.length >= 4 && /思考模式/.test(rest[0].paragraphs[0] || '')) {
          mode = rest[0].paragraphs[0]
          cond = rest[1].paragraphs[0] || ''
          priceCells = rest.slice(2)
        } else {
          cond = rest[0].paragraphs[0] || ''
          priceCells = rest.slice(1)
        }
        const key = name.toLowerCase()
        const row = { id: name, hints: cells[0].paragraphs.slice(1), mode, cond, prices: [], seen: new Set() }
        for (const c of priceCells) {
          const p = qwenPrice(c.paragraphs[0])
          if (p) row.prices.push(p)
        }
        const dedup = key + '|' + cond + '|' + row.prices.map((p) => p.value).join(',')
        if (rows.has(key) && rows.get(key).seen.has(dedup)) continue
        const entry = rows.get(key) || { id: name, hints: [], tiers: [], modes: new Set(), flags: new Set(), seen: new Set() }
        entry.seen.add(dedup)
        entry.hints = entry.hints.concat(row.hints)
        entry.modes.add(row.mode || '')
        const cap = qwenTierCap(cond)
        if (!cap) continue
        entry.tiers.push({ cap, prices: row.prices })
        rows.set(key, entry)
        prev = entry
        continue
      }
      // 阶梯续行：挂到上一个型号（页面有转义+渲染两份，按内容去重）
      if (!prev) continue
      const cap = qwenTierCap(name)
      if (!cap) continue
      const prices = []
      for (const c of cells.slice(1)) {
        const p = qwenPrice(c.paragraphs[0])
        if (p) prices.push(p)
      }
      const contDedup = prev.id.toLowerCase() + '|' + cap.label + '|' + prices.map((p) => p.value).join(',')
      if (prev.seen.has(contDedup)) continue
      prev.seen.add(contDedup)
      prev.tiers.push({ cap, prices })
    }
  }
  if (rows.size === 0) return { ok: false, error: 'Qwen 价格表解析失配（北京分区未识别到型号行），保留上一次有效价格' }
  // 同价快照行（qwen3.8-max-0902 等）并入主型号别名；「当前能力等同于 X」→ X 记为别名
  const ids = Array.from(rows.keys()).sort((a, b) => a.length - b.length)
  const sig = (ts) => JSON.stringify(ts.map((t) => [t.cap.maxInputTokens, t.cap.maxOutputTokens, t.prices.map((p) => p.value)]))
  const aliasOf = new Map()
  for (const a of ids) {
    for (const b of ids) {
      if (a === b || !b.startsWith(a + '-')) continue
      if (sig(rows.get(a).tiers) === sig(rows.get(b).tiers)) aliasOf.set(b, a)
    }
  }
  // 第一遍：先把全部别名合并算完（同价快照行 + 「当前能力等同于 X」提示），
  // 否则后出现的快照行（qwen-plus-latest、qwen3.7-max-2026-06-08 等）会在主型号
  // 构建完成后才写入 mergedAliases，造成别名丢失。
  const eqRegex = /当前能力等同于([\w.-]+)/g
  for (const [, row] of rows) {
    // 附属行含 span 残留空格（"当前能力等同于  X"、"Batch  调用 半价"），匹配前归一
    row.normHints = row.hints.map((h) => h.replace(/\s+/g, ''))
    const eqIds = []
    for (const h of row.normHints) {
      eqRegex.lastIndex = 0
      let m
      while ((m = eqRegex.exec(h))) eqIds.push(m[1])
    }
    row.eqIds = eqIds.filter((x) => x.toLowerCase() !== row.id.toLowerCase())
  }
  for (const [key] of rows) {
    const aliasTarget = aliasOf.get(key)
    if (!aliasTarget) continue
    const row = rows.get(key)
    const target = rows.get(aliasTarget)
    target.mergedAliases = (target.mergedAliases || []).concat([row.id])
  }
  const models = []
  for (const [key, row] of rows) {
    if (aliasOf.has(key)) continue
    const hints = row.normHints
    const aliases = []
    const addAlias = (x) => {
      if (x && !aliases.some((a) => a.toLowerCase() === x.toLowerCase())) aliases.push(x)
    }
    for (const eq of row.eqIds) addAlias(eq)
    const hasCacheHint = hints.some((h) => h.indexOf('上下文缓存享有折扣') >= 0)
    const hasBatchHint = hints.some((h) => h.indexOf('Batch调用半价') >= 0)
    const supported = hasCacheHint || support.has(key) || aliases.some((a) => support.has(a.toLowerCase()))
    const isException = QWEN_CACHE_EXCEPTIONS.has(key) || QWEN_CACHE_EXCEPTIONS.has(row.id)
    const isFlashException = key === QWEN_FLASH_EXACT
    const anyDiscount = row.tiers.some((t) => t.prices.some((p) => p.discount))
    const tiers = row.tiers.map((t) => {
      const three = t.prices.length >= 3
      const input = t.prices[0]
      const outNT = three ? t.prices[1] : t.prices[1]
      const outT = three ? t.prices[2] : t.prices[1]
      const cached = (supported && !isException && input) ? Math.round(input.value * QWEN_CACHE_RATIOS.hit * 1e10) / 1e10 : null
      const tier = {
        label: t.cap.label,
        maxInputTokens: t.cap.maxInputTokens,
        buckets: {
          input: input ? input.value : null,
          cachedInput: cached,
          output: outNT ? outNT.value : null
        }
      }
      if (outT && outNT && outT.value !== outNT.value) tier.thinkingOutput = outT.value
      else if (outT && outNT) tier.thinkingOutput = outT.value
      return tier
    })
    const allEqual = row.tiers.every((t) => t.prices.length < 3 || t.prices[1].value === t.prices[2].value)
    const model = {
      officialModelId: row.id,
      aliases,
      currency: 'CNY',
      unit: 'per_1m_tokens',
      tiers,
      thinking: row.modes.has('仅非思考模式')
        ? { supported: false, separatelyPriced: false, note: '仅非思考模式' }
        : allEqual
          ? { supported: true, separatelyPriced: false, outputIncludes: '思维链+回答' }
          : { supported: true, separatelyPriced: true, outputIncludes: '思维链+回答' },
      cache: supported
        ? {
            supported: true,
            modes: ['explicit', 'implicit'],
            writeRatioOfInput: isFlashException ? null : QWEN_CACHE_RATIOS.write,
            hitRatioOfInput: isException ? null : QWEN_CACHE_RATIOS.hit,
            implicitHitRatioOfInput: isException ? null : QWEN_CACHE_RATIOS.implicitHit,
            minCacheableTokens: QWEN_CACHE_RATIOS.minTokens,
            ttlSeconds: QWEN_CACHE_RATIOS.ttlSeconds,
            storageFee: null
          }
        : { supported: false, note: '不在官方上下文缓存支持模型列表（北京）内' },
      batch: hasBatchHint ? { supported: true, ratioOfRealtime: 0.5 } : null,
      effectiveFrom: null,
      completeness: 'full',
      missing: []
    }
    if (isException) {
      model.missing.push('cacheHitUnitPrice')
      if (isFlashException) model.missing.push('cacheWriteUnitPrice')
      model.cache.note = '官方例外型号：显式缓存单价不适用通用比例（' + QWEN_CACHE_URL + '『例外』段），公开页无数值，不猜测'
    }
    if (anyDiscount) {
      model.note = '页面价格为原价并标『限时8折』，折后价未公布（不猜测）'
    }
    if (row.mergedAliases && row.mergedAliases.length) {
      for (const ma of row.mergedAliases) addAlias(ma)
    }
    models.push(model)
  }
  const notes = [
    '阶梯按单次请求输入 Token 总量定档、整请求按该档结算（K=1,000、M=1,000,000）',
    'cachedInput 为比例推导（官方公布命中 ' + Math.round(QWEN_CACHE_RATIOS.hit * 100) + '% × 输入单价算术结果，非页面数字）',
    '缓存规则来源 ' + QWEN_CACHE_URL + '；例外型号命中价公开页无数值'
  ]
  return buildSourceBlock({ ...payload, ok: true, models, notes }, normalizeSampleModel)
}

// ── 第三方市场已核验别名 ────────────────────────────────────────────────────

/**
 * 第三方市场（如 Command Code GOAT）模型目录中的 ID → 开发方官方型号。
 *
 * 纪律：只登记逐条核验过的映射，scope 限定为核验到该命名的平台 provider id
 * （"在哪家核验在哪家生效"），不外推、不按前缀猜。依据见
 * docs/source-verification/。未核验的市场 ID 维持"未计价"显形。
 */
const MARKETPLACE_ALIASES = Object.freeze([
  {
    sourceId: 'deepseek',
    officialModelId: 'deepseek-flash',
    // 依据：DeepSeek 价格页脚注 1（旧名请求由 DeepSeek-V4.1-Flash-1017
    // 提供服务并按 Flash 价格计费）+ Command Code GOAT 模型目录。
    aliases: [
      { id: 'deepseek/deepseek-v4.1-flash', scope: ['command-code-goat'] },
      { id: 'deepseek-v4.1-flash', scope: ['command-code-goat'] }
    ]
  },
  {
    sourceId: 'mimo',
    officialModelId: 'mimo-v2.6-flash',
    aliases: [{ id: 'xiaomi/mimo-v2.6-flash', scope: ['command-code-goat'] }]
  },
  {
    sourceId: 'glm',
    officialModelId: 'glm-5.3-flash',
    aliases: [{ id: 'z-ai/glm-5.3-flash', scope: ['command-code-goat'] }]
  }
])

/**
 * 把市场别名并入解析结果（幂等；目录里没有对应官方条目就不登记，不猜）。
 * 挂在 parse 出口 → seed 生成与运行时刷新走同一覆盖，刷新不会冲掉。
 */
function applyMarketplaceAliases(result, sourceId) {
  if (!result || !result.ok || !result.block || !Array.isArray(result.block.models)) return result
  for (const model of result.block.models) {
    const rule = MARKETPLACE_ALIASES.find(
      (r) => r.sourceId === sourceId && r.officialModelId === model.officialModelId
    )
    if (!rule) continue
    const have = new Set((model.aliases || []).map((a) => String((a && a.id) || '').toLowerCase()))
    model.aliases = [...(model.aliases || [])]
    for (const alias of rule.aliases) {
      if (have.has(alias.id.toLowerCase())) continue
      model.aliases.push({ id: alias.id, scope: [...alias.scope] })
    }
  }
  return result
}

// ── 来源注册表 ───────────────────────────────────────────────────────────

export const SOURCE_DEFS = Object.freeze([
  {
    sourceId: 'deepseek',
    vendor: 'DeepSeek',
    sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
    hosts: ['api-docs.deepseek.com'],
    fetchUrls: ['https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md'],
    parseText: parseDeepseekText
  },
  {
    sourceId: 'mimo',
    vendor: '小米 MiMo',
    sourceUrl: 'https://mimo.mi.com/docs/pricing',
    hosts: ['mimo.mi.com'],
    fetchUrls: ['https://mimo.mi.com/static/docs/price/pay-as-you-go.md'],
    parseText: parseMimoText
  },
  {
    sourceId: 'qwen',
    vendor: '千问 Qwen（百炼）',
    sourceUrl: 'https://help.aliyun.com/zh/model-studio/model-pricing',
    hosts: ['help.aliyun.com', 'aliyun.com'],
    fetchUrls: [
      'https://help.aliyun.com/zh/model-studio/model-pricing',
      'https://help.aliyun.com/zh/model-studio/context-cache'
    ],
    parseText: parseQwenText
  },
  {
    sourceId: 'kimi',
    vendor: 'Kimi（月之暗面）',
    sourceUrl: 'https://platform.kimi.com/docs/pricing/chat',
    hosts: ['platform.kimi.com', 'kimi.com'],
    fetchUrls: [
      'https://platform.kimi.com/docs/pricing/chat',
      'https://platform.kimi.com/docs/pricing/batch'
    ],
    parseText: parseKimiText
  },
  {
    sourceId: 'glm',
    vendor: '智谱 GLM',
    sourceUrl: 'https://docs.bigmodel.cn/cn/guide/start/pricing',
    hosts: ['docs.bigmodel.cn', 'bigmodel.cn'],
    fetchUrls: ['https://docs.bigmodel.cn/cn/guide/start/pricing.md'],
    parseText: parseGlmText
  }
])

/** 构造一个来源适配器。`fetcher` 见 sources/common.js。 */
export function createSourceAdapter(def) {
  return {
    sourceId: def.sourceId,
    sourceUrl: def.sourceUrl,
    hosts: def.hosts,
    async fetchRaw(fetcher) {
      const urls = def.fetchUrls && def.fetchUrls.length > 0 ? def.fetchUrls : [def.sourceUrl]
      const pages = []
      let lastError = ''
      for (const url of urls) {
        const raw = await fetchSource(fetcher, { url, hosts: def.hosts })
        if (raw.ok) {
          pages.push({ url, body: raw.body })
          continue
        }
        lastError = raw.error || '读取失败'
        // 多页来源：任一必需页面缺失即整体失败（宁可保留上一次有效价格）。
        if (urls.length > 1) return { ok: false, error: url + '：' + lastError }
      }
      if (pages.length === 0) return { ok: false, error: lastError || '读取失败' }
      return { ok: true, body: pages[0].body, url: pages[0].url, pages }
    },
    parse(raw) {
      if (!raw || !raw.ok) return { ok: false, error: (raw && raw.error) || '读取失败' }
      const payload = {
        sourceId: def.sourceId,
        sourceUrl: def.sourceUrl,
        vendor: def.vendor,
        fetchedAt: new Date().toISOString()
      }
      // 1) 结构化样本 / JSON 端点
      try {
        const parsed = JSON.parse(raw.body)
        if (parsed && Array.isArray(parsed.models)) {
          return applyMarketplaceAliases(buildSourceBlock({ ...parsed, sourceId: def.sourceId, sourceUrl: def.sourceUrl, vendor: def.vendor }, normalizeSampleModel), def.sourceId)
        }
      } catch (e) { /* 非 JSON，继续走文本解析 */ }
      // 2) 官方页面原文（仅对已实测结构的来源启用）
      if (typeof def.parseText === 'function') return applyMarketplaceAliases(def.parseText(raw.body, payload, raw), def.sourceId)
      return {
        ok: false,
        error: def.sourceId + ' 来源暂无可靠的自动解析通道（页面为动态渲染 / 结构未实测），保留上一次有效价格'
      }
    }
  }
}

/** 全部来源适配器（键为 sourceId）。 */
export function createSourceAdapters() {
  const out = {}
  for (const def of SOURCE_DEFS) out[def.sourceId] = createSourceAdapter(def)
  return out
}

export { normalizeSampleModel, normalizeBuckets, defaultPeakValleyPeriods }
