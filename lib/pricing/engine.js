/**
 * dsh-usage-plugin — 官方价参考金额计算引擎（可独立测试的纯计算）。
 *
 * 输入：确认后的官方型号条目、调用时点、地域、模式、用量分桶、汇率；
 * 输出：金额明细或**明确的不可计价状态**。每个规则只在所需字段齐全且分桶
 * 语义明确时生效；缺档位、缺价格、缺汇率、缺用量都返回结构化状态而不是 0。
 *
 * 精度：价格先归一到「原币 / 百万 tokens」，金额用 BigInt 纳单位定点累加
 * （1 纳币 = 1e-9 币），最后才转成展示用浮点。大量小额累加不会漂移，
 * 舍入只发生在展示层。
 *
 * 金额口径：`null` = 无法可靠计算；数值 0 只表示官方明示免费或有效用量
 * 的计算结果确为零。
 *
 * @module dsh-usage-plugin/pricing/engine
 */

// ── 定点精度原语 ─────────────────────────────────────────────────────────
const NANO = 1000000000

/** 把十进制价格转成纳单位整数（四舍五入到 1e-9）。 */
export function toNano(value) {
  return BigInt(Math.round(Number(value) * NANO))
}

/** 纳单位整数 → 展示浮点。 */
export function nanoToNumber(nano) {
  return Number(nano) / NANO
}

/**
 * tokens × 单价（原币 / 百万 tokens）→ 纳币。
 * 全程 BigInt，最后一步除以 1e6 取整（向下取整，避免小额虚增）。
 */
export function costNano(tokens, pricePerMillion) {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0n
  return (BigInt(Math.round(tokens)) * toNano(pricePerMillion)) / 1000000n
}

/** 汇率折算（纳币 × 汇率），同样只在整数域移动小数点。 */
export function scaleNano(nano, rate) {
  if (!Number.isFinite(rate) || rate <= 0) return null
  return (nano * BigInt(Math.round(rate * NANO))) / BigInt(NANO)
}

// ── 用量分桶 ─────────────────────────────────────────────────────────────

/**
 * 记录 → 计价用量分桶。四桶互斥，reasoning 是 output 的子集，不参与计价。
 *
 * @param rec - 记录（原始 / 归一化 / 投影形状均可）。
 * @returns {{input:number, cacheRead:number, cacheWrite:number, output:number, total:number}}
 */
export function usageOf(rec) {
  const input = Number((rec && rec.inputTokens) || 0)
  const cacheRead = Number((rec && rec.cacheReadTokens) || 0)
  const cacheWrite = Number((rec && rec.cacheWriteTokens) || 0)
  const output = Number((rec && rec.outputTokens) || 0)
  return {
    input: input > 0 ? input : 0,
    cacheRead: cacheRead > 0 ? cacheRead : 0,
    cacheWrite: cacheWrite > 0 ? cacheWrite : 0,
    output: output > 0 ? output : 0,
    total: (input > 0 ? input : 0) + (cacheRead > 0 ? cacheRead : 0) + (cacheWrite > 0 ? cacheWrite : 0) + (output > 0 ? output : 0)
  }
}

// ── 档位与时段选择 ───────────────────────────────────────────────────────

/**
 * 选择计价档位（官方输入／输出阶梯 + 价格生效区间）。
 *
 * 用本次请求实际的输入 token 数（未命中 + 命中 + 写入）选档；缺少准确值时
 * **不猜档位**，返回 null 并由调用方报 missing_rule / missing_usage。
 * 同一型号的不同价格时代用 `validFrom/validTo` 区分，按调用时点选中。
 *
 * @param entry - 官方型号条目。
 * @param usage - usageOf 的结果。
 * @param mode - 调用模式（'standard' / 'thinking' / null）。
 * @param at - 计价时点（毫秒）。
 * @returns {{ tier: object|null, reason: string }}
 */
export function selectTier(entry, usage, mode, at) {
  const tiers = (entry && entry.tiers) || []
  if (tiers.length === 0) return { tier: null, reason: '条目没有价格分档', assumption: '' }
  let candidates = tiers
  if (at != null) {
    const inRange = candidates.filter((t) =>
      (t.validFrom == null || at >= t.validFrom) && (t.validTo == null || at < t.validTo))
    if (inRange.length > 0) candidates = inRange
    else return { tier: null, reason: '调用时点不在任何已核实的价格生效区间内', assumption: '' }
  }
  if (mode) {
    const byMode = candidates.filter((t) => !t.mode || t.mode === mode)
    if (byMode.length === 0) return { tier: null, reason: '缺少模式 ' + mode + ' 的价格规则', assumption: '' }
    return pickByLength(byMode, usage, '')
  }
  // 未标注调用方式：批量价是独立计费通道（不走流式探针），只在显式标注时选用；
  // 其余模式（思考 / 非思考等）价格不同时不猜档，价格一致时按统一价处理。
  const nonBatch = candidates.filter((t) => t.mode !== 'batch')
  const pool = nonBatch.length > 0 ? nonBatch : candidates
  const explicitModes = pool.filter((t) => t.mode)
  if (explicitModes.length > 0) {
    const shapes = new Set(explicitModes.map((t) => JSON.stringify(t.prices || null)))
    if (shapes.size > 1) {
      return { tier: null, reason: '调用模式未知，且不同模式价格不同（如思考 / 非思考）', assumption: '' }
    }
  }
  // 批量价是独立异步通道，只有显式 mode='batch' 才会命中；记录未标注通道时
  // 按非批量（实时）价计算，这是默认路径而不是“假设”，不因此标记 estimated。
  return pickByLength(pool, usage, '')
}

/** 按输入／输出长度阶梯选档（联合分档缺一侧 token 数都不猜档）。 */
function pickByLength(candidates, usage, assumption) {
  const fail = (reason) => ({ tier: null, reason, assumption })
  const inputLen = usage.input + usage.cacheRead + usage.cacheWrite
  const byLength = candidates.filter((t) => t.maxInputTokens != null || t.maxOutputTokens != null)
  if (byLength.length === 0) return { tier: candidates[0], reason: '', assumption }
  if (byLength.some((t) => t.maxOutputTokens != null) && !(usage.output > 0)) {
    return fail('缺少输出 token 数，无法确定输入×输出联合档位')
  }
  if (byLength.some((t) => t.maxInputTokens != null) && !(inputLen > 0)) {
    return fail('缺少输入长度，无法确定阶梯档位')
  }
  const fit = candidates
    .filter((t) => (t.maxInputTokens == null || inputLen <= t.maxInputTokens) &&
      (t.maxOutputTokens == null || usage.output <= t.maxOutputTokens))
    .sort((a, b) => {
      const ai = a.maxInputTokens == null ? Infinity : a.maxInputTokens
      const bi = b.maxInputTokens == null ? Infinity : b.maxInputTokens
      if (ai !== bi) return ai - bi
      const ao = a.maxOutputTokens == null ? Infinity : a.maxOutputTokens
      const bo = b.maxOutputTokens == null ? Infinity : b.maxOutputTokens
      return ao - bo
    })
  if (fit.length === 0) return fail('输入/输出长度超出所有已知阶梯')
  return { tier: fit[0], reason: '', assumption }
}

/**
 * 判断某时刻是高峰还是空闲（北京时区，按条目 periods 规则）。
 *
 * 规则顺序（与官方价目一致）：
 *   1. at ≥ weekendFlatFrom 且是周六/周日 → 空闲；
 *   2. at ≥ holidayFlatFrom 且当天是法定节假日 → 空闲；
 *   3. 其余按 peakWindows（北京时间分钟区间）判定。
 * 节假日表只在覆盖年份内有效；超出覆盖年份**不静默假定不是节假日**，
 * 而是返回 `incomplete`，让调用方标注"时段规则不完整"。
 *
 * @returns {{ windowId: 'peak'|'offPeak'|null, incomplete: boolean, note: string }}
 */
export function periodWindowAt(periods, at) {
  if (!periods || periods.kind !== 'peak-valley') return { windowId: null, incomplete: false, note: '' }
  const d = new Date(Number(at) + 8 * 3600 * 1000)
  const wd = d.getUTCDay()
  const dayKey = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
  const year = d.getUTCFullYear()
  if (Number.isFinite(periods.weekendFlatFrom) && at >= periods.weekendFlatFrom && (wd === 0 || wd === 6)) {
    return { windowId: 'offPeak', incomplete: false, note: '周末全天空闲价' }
  }
  const holidayFrom = Number(periods.holidayFlatFrom) || 0
  if (at >= holidayFrom) {
    const table = periods.holidays || {}
    const covered = Array.isArray(table.coveredYears) ? table.coveredYears : []
    const days = Array.isArray(table.days) ? table.days : []
    if (covered.indexOf(year) < 0) {
      // 超出已核实年份：不能假定不是节假日，也不能假定是——按规则不完整处理。
      return {
        windowId: null,
        incomplete: true,
        note: '节假日数据只覆盖 ' + (covered.join('、') || '无') + '，无法判定 ' + year + ' 年的峰谷时段'
      }
    }
    if (days.indexOf(dayKey) >= 0) return { windowId: 'offPeak', incomplete: false, note: '法定节假日全天空闲价' }
  }
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  const windows = Array.isArray(periods.peakWindows) ? periods.peakWindows : []
  for (const w of windows) {
    if (Array.isArray(w) && w.length === 2 && minutes >= w[0] && minutes < w[1]) {
      return { windowId: 'peak', incomplete: false, note: '工作日高峰时段' }
    }
  }
  return { windowId: 'offPeak', incomplete: false, note: '工作日空闲时段' }
}

/**
 * 取某档位在指定时段的价格行。
 *
 * @returns {{ prices: object|null, windowId: string|null, reason: string }}
 */
export function priceRowOf(tier, windowId) {
  if (!tier) return { prices: null, windowId: null, reason: '缺少价格分档' }
  const windows = Array.isArray(tier.windows) ? tier.windows : []
  if (windows.length === 0) return { prices: tier.prices || null, windowId: null, reason: '' }
  const hit = windows.find((w) => w.id === windowId) || windows.find((w) => w.id === 'default')
  if (!hit) {
    return { prices: null, windowId, reason: '缺少时段 ' + windowId + ' 的价格（可选：' + windows.map((w) => w.id).join('/') + '）' }
  }
  return { prices: hit.prices || null, windowId: hit.id, reason: '' }
}

// ── 金额计算 ─────────────────────────────────────────────────────────────

/**
 * 用给定价格行计算一笔用量的金额（原币，纳单位）。
 *
 * 分桶语义：
 *   - `input`（未命中输入）→ prices.input；
 *   - `cacheRead`（缓存命中）→ prices.cacheRead；未单列且官方规则是"按输入价"
 *     （readFallbackToInput）时按 prices.input，否则缺价；
 *   - `cacheWrite`（缓存写入）→ prices.cacheWrite；未单列且官方规则是
 *     "按未命中价计"（writeBilledAs='miss'）时按 prices.input，否则缺价；
 *   - `output` → prices.output。
 *
 * @returns {{ nano, missing: string[] }}
 */
/**
 * 价格行 → 逐桶有效单价。
 *
 * 特例一：官方"缓存写入按未命中价计"（cache.writeBilledAs='miss'）或
 * "缓存读取按输入价计"（cache.readFallbackToInput）时按对应桶换算。
 * 特例二：缓存写入按 TTL 分档（如 Kimi 5m/1h）时，`prices.cacheWrite` 是
 * `{ ttl5m, ttl1h }` 形状；请求未带 TTL 时按官方**默认档**取价，并由调用方
 * 记入 assumptions（不是缺价，也不是悄悄取最高/最低档）。
 *
 * @returns {{ prices: object, assumptions: string[] }}
 */
export function resolveBucketPrices(prices, cache, opts) {
  const rules = cache || {}
  const assumptions = []
  const pick = (key, fallbackKey) => {
    const direct = prices ? prices[key] : null
    if (typeof direct === 'number') return direct
    if (direct && typeof direct === 'object') {
      const want = opts && opts.cacheTtl ? String(opts.cacheTtl) : ''
      if (want && typeof direct[want] === 'number') return direct[want]
      const def = rules.writeTtlDefault && typeof direct[rules.writeTtlDefault] === 'number'
        ? direct[rules.writeTtlDefault]
        : null
      if (def !== null) {
        assumptions.push(key + ':' + rules.writeTtlDefault + '(官方默认 TTL 档)')
        return def
      }
      return null
    }
    if (fallbackKey && rules[fallbackKey.key] === fallbackKey.value) {
      const fb = prices ? prices[fallbackKey.as] : null
      if (typeof fb === 'number') return fb
    }
    return null
  }
  return {
    prices: {
      input: pick('input', null),
      cacheRead: pick('cacheRead', { key: 'readFallbackToInput', value: true, as: 'input' }),
      cacheWrite: pick('cacheWrite', { key: 'writeBilledAs', value: 'miss', as: 'input' }),
      output: pick('output', null)
    },
    assumptions
  }
}

/**
 * 用量 × 单价 → 纳币。只有**用量大于 0** 的桶才要求有价；
 * 用量为 0 的桶缺价不影响完整性（0 用量本来就不产生金额）。
 */
export function bucketsNano(prices, usage, cache, opts) {
  const resolved = resolveBucketPrices(prices, cache, opts)
  const effective = resolved.prices
  const missing = []
  let nano = 0n
  for (const key of ['input', 'cacheRead', 'cacheWrite', 'output']) {
    const tokens = usage[key]
    if (!(tokens > 0)) continue
    const price = effective[key]
    if (typeof price === 'number') nano += costNano(tokens, price)
    else missing.push(key)
  }
  return { nano, missing, effective, assumptions: resolved.assumptions }
}

/**
 * 完整计价入口：官方型号条目 + 用量 + 时点 → 金额或明确的不可计价状态。
 *
 * @param args - `{ entry, usage, at, mode, fxRate, stale, requestModel, provider, basis }`。
 * @returns 见文件头的金额口径说明。
 */
export function priceCall(args) {
  const { entry, usage, at } = args || {}
  const fxRate = Number(args && args.fxRate) || 0
  const out = {
    status: 'missing_rule',
    amountCny: null,
    amountOriginal: null,
    currency: entry ? entry.currency : null,
    nano: null,
    missing: [],
    note: '',
    partial: false,
    stale: false,
    estimated: false,
    unverified: false,
    assumptions: [],
    tierId: null,
    windowId: null,
    periodKind: null
  }
  if (!entry) {
    out.status = 'unknown_model'
    out.note = (args && args.note) || '没有可确认的官方型号'
    return out
  }
  if (entry.pricingExcluded === true || entry.bucketSemantics === 'unsplit') {
    // 非 token 计价项（按次 / 按时长），或官方只给"每百万 tokens 单一价"而未
    // 区分输入/输出桶：分桶语义不明确，按硬约束不套用文本公式，标为不可计价。
    out.status = 'missing_rule'
    out.note = entry.pricingExcluded === true
      ? '非 token 计价项（按次 / 按时长等），插件无对应用量，未覆盖'
      : '官方单价未区分输入/输出桶（分桶语义不明确），不自动计价'
    return out
  }
  if (!usage || !(usage.total > 0)) {
    out.status = 'missing_usage'
    out.note = '缺少上游用量（中断 / 未上报），无法计价'
    return out
  }
  const tierPick = selectTier(entry, usage, args && args.mode, at)
  if (!tierPick.tier) {
    out.status = 'missing_rule'
    out.note = tierPick.reason
    return out
  }
  const tierAssumptions = tierPick.assumption ? [tierPick.assumption] : []
  const tier = tierPick.tier
  let windowId = null
  let periodNote = ''
  if (Array.isArray(tier.windows) && tier.windows.length > 0) {
    const pw = periodWindowAt(entry.periods, at)
    if (!pw.windowId) {
      out.status = 'missing_rule'
      out.note = pw.note || '无法确定峰谷时段'
      out.partial = false
      return out
    }
    windowId = pw.windowId
    periodNote = pw.note
    out.periodKind = (entry.periods && entry.periods.kind) || 'peak-valley'
  }
  const row = priceRowOf(tier, windowId)
  if (!row.prices) {
    out.status = 'missing_price'
    out.note = row.reason || '缺少价格'
    return out
  }
  const calc = bucketsNano(row.prices, usage, entry.cache, { cacheTtl: args && args.cacheTtl })
  out.tierId = tier.id || null
  out.windowId = row.windowId
  out.nano = calc.nano
  out.effectivePrices = calc.effective
  out.amountOriginal = nanoToNumber(calc.nano)
  out.missing = calc.missing
  out.assumptions = [...tierAssumptions, ...calc.assumptions]
  out.estimated = out.assumptions.length > 0
  // 未经本次官方核验的历史价段（如官方仅存图片的旧价）：金额可用但必须可追溯。
  if (tier.verified === false) {
    out.unverified = true
    out.estimated = true
  }
  if (calc.missing.length > 0) {
    // 部分金额：缺价分项**不按 0 计入"完整"**，状态单独标出。
    out.status = 'missing_price'
    out.partial = true
    out.note = '缺少分项价格：' + calc.missing.join('、')
    out.amountCny = null
    out.amountOriginal = null
    return out
  }
  const isFree = out.amountOriginal === 0 && Object.values(row.prices).every((v) => v === null || v === 0)
  if (isFree) {
    out.status = 'free'
    out.amountCny = 0
    out.amountOriginal = 0
    out.note = periodNote || '官方价格明确免费'
    return out
  }
  if (entry.currency === 'CNY') {
    out.amountCny = out.amountOriginal
  } else if (fxRate > 0) {
    const scaled = scaleNano(calc.nano, fxRate)
    out.amountCny = scaled === null ? null : nanoToNumber(scaled)
  } else {
    out.status = 'missing_fx'
    out.note = '缺少 ' + entry.currency + '/CNY 汇率，人民币金额未知'
    out.amountCny = null
    return out
  }
  out.status = args && args.stale ? 'stale_price' : 'priced'
  out.stale = !!args.stale
  out.note = periodNote
  return out
}

// ── 价格快照（冻结） ─────────────────────────────────────────────────────

/**
 * 由计价结果生成**随调用绑定**的价格快照。
 *
 * 快照只保存本次用到的价格行与规则坐标，不引用目录对象本身；之后任何
 * 目录刷新都不会改写它的金额（结束时才能确定的用量阶梯也用本次绑定的
 * 规则计算，避免后台刷新与流式调用竞态）。
 */
export function buildSnapshot(args) {
  const { entry, tier, windowId, prices, result } = args || {}
  if (!entry || !result) return null
  const snap = {
    v: 1,
    sourceId: entry.sourceId,
    officialModelId: entry.officialModelId,
    requestModel: (args && args.requestModel) || '',
    provider: (args && args.provider) || '',
    basis: (args && args.basis) || 'none',
    currency: entry.currency,
    unit: entry.unit,
    region: entry.region == null ? null : entry.region,
    mode: (args && args.mode) || null,
    tierId: (tier && tier.id) || null,
    windowId: windowId || null,
    periodKind: (entry.periods && entry.periods.kind) || null,
    prices: {},
    effective: {
      known: !!(entry.effective && entry.effective.known),
      from: entry.effective && entry.effective.known ? (entry.effective.from || null) : null,
      to: entry.effective && entry.effective.known ? (entry.effective.to || null) : null
    },
    fetchedAt: Number(entry.fetchedAt) || 0,
    priceVersion: entry.priceVersion || '',
    fx: null,
    status: result.status,
    estimated: !!result.estimated,
    unverified: !!result.unverified,
    assumptions: Array.isArray(result.assumptions) ? result.assumptions.slice() : [],
    missing: Array.isArray(result.missing) ? result.missing.slice() : [],
    note: result.note || ''
  }
  for (const key of ['input', 'cacheRead', 'cacheWrite', 'output']) {
    // 保存**已解析到桶**的有效单价（含官方"写入按未命中价计"之类的换算结果），
    // 这样快照重算不再需要当时的规则对象。
    const v = prices ? prices[key] : null
    snap.prices[key] = typeof v === 'number' ? v : null
  }
  if (args && args.fxRate > 0) {
    snap.fx = { rate: Number(args.fxRate), source: String(args.fxSource || ''), date: String(args.fxDate || '') }
  }
  return snap
}

/**
 * 用快照里冻结的价格重算金额（不读目录、不读当前价格表）。
 *
 * @param snapshot - buildSnapshot 的产物（或其持久化副本）。
 * @param usage - usageOf 的结果。
 * @returns `{ status, amountCny, amountOriginal, missing, note }`。
 */
export function computeFromSnapshot(snapshot, usage) {
  const out = { status: 'missing_rule', amountCny: null, amountOriginal: null, missing: [], note: '' }
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.prices) {
    out.status = 'missing_rule'
    out.note = '没有价格快照'
    return out
  }
  if (!usage || !(usage.total > 0)) {
    out.status = 'missing_usage'
    out.note = '缺少上游用量'
    return out
  }
  const calc = bucketsNano(snapshot.prices, usage, null)
  out.missing = calc.missing
  if (calc.missing.length > 0) {
    out.status = 'missing_price'
    out.note = '快照缺少分项价格：' + calc.missing.join('、')
    return out
  }
  out.amountOriginal = nanoToNumber(calc.nano)
  if (snapshot.currency === 'CNY') {
    out.amountCny = out.amountOriginal
    out.status = snapshot.status === 'free' ? 'free' : 'priced'
    return out
  }
  const rate = snapshot.fx && Number(snapshot.fx.rate) > 0 ? Number(snapshot.fx.rate) : 0
  if (rate > 0) {
    const scaled = scaleNano(calc.nano, rate)
    out.amountCny = scaled === null ? null : nanoToNumber(scaled)
    out.status = snapshot.status === 'free' ? 'free' : 'priced'
    return out
  }
  out.status = 'missing_fx'
  out.note = '快照缺少 ' + snapshot.currency + '/CNY 汇率'
  return out
}
