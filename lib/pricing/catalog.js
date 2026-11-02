/**
 * dsh-usage-plugin — 官方价格目录（统一条目、版本与校验）。
 *
 * 第一阶段的计价口径：无论从哪个平台调用，先确定调用的具体模型，再采用该模型
 * **开发方官方 API** 的公开按量价格与规则估算（"官方价参考金额"）。因此目录里
 * 把「模型作者（sourceId）」与「实际调用平台（provider）」分开保存：
 * 调用平台只用于别名消歧与对账，不参与选价。
 *
 * 目录条目是纯数据；所有校验集中在这里，来源解析器的输出必须先过校验才能
 * 替换上一次有效缓存——结构异常、价格缺失或解析器失配时拒绝替换。
 *
 * @module dsh-usage-plugin/pricing/catalog
 */

/** 目录结构版本号（条目形状变化时 +1，用于快照与缓存兼容判断）。 */
export const CATALOG_VERSION = 1

/** 计价单位（引擎统一归一到 per_1m_tokens 再计算）。 */
export const PRICE_UNITS = ['per_1m_tokens', 'per_1k_tokens']

/** 计费桶语义（缺一不可含糊：没有对应语义的桶不参与计算）。 */
export const USAGE_BUCKETS = ['input', 'cacheRead', 'cacheWrite', 'output']

/** 完整性标注。 */
export const COMPLETENESS = ['full', 'partial']

const isId = (v) => typeof v === 'string' && v.trim() !== '' && v.length <= 200
const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
const isTs = (v) => v == null || (typeof v === 'number' && Number.isFinite(v) && v > 0)

/**
 * 价格行校验：每个键必须是非负有限数字（单位由所在条目声明）。
 * 允许缺失的桶显式写 `null`（表示"官方未单列 / 未覆盖"），而不是留假 0。
 *
 * @returns {string[]} 错误列表（空表示通过）。
 */
export function validatePriceRow(row, path) {
  const errors = []
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    errors.push(path + ' 必须是对象')
    return errors
  }
  for (const [k, v] of Object.entries(row)) {
    if (v === null) continue
    if (typeof v === 'object' && !Array.isArray(v)) {
      // TTL 分档价格（如 Kimi 缓存写入 5m/1h）：值必须都是非负数字。
      const vals = Object.values(v)
      if (vals.length === 0 || !vals.every(isNum)) errors.push(path + '.' + k + ' 的分档价格必须都是非负数字')
      continue
    }
    if (!isNum(v)) errors.push(path + '.' + k + ' 必须是非负数字或 null')
  }
  return errors
}

/**
 * 模型条目校验（严格）。通过的条目才允许进入目录。
 *
 * 必填：sourceId、officialModelId、currency、unit、tiers（非空）、
 *      effective、fetchedAt、completeness。
 * 价格不完整时 completeness 必须是 'partial' 且 missing 列出缺失项。
 *
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateModelEntry(entry) {
  const errors = []
  const p = 'entry'
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, errors: [p + ' 必须是对象'] }
  }
  if (!isId(entry.sourceId)) errors.push(p + '.sourceId 缺失')
  if (!isId(entry.officialModelId)) errors.push(p + '.officialModelId 缺失')
  if (!isId(entry.currency)) errors.push(p + '.currency 缺失')
  if (!PRICE_UNITS.includes(entry.unit) && entry.pricingExcluded !== true) {
    errors.push(p + '.unit 非法：' + String(entry.unit))
  }
  if (!COMPLETENESS.includes(entry.completeness)) errors.push(p + '.completeness 非法')
  if (!isTs(entry.fetchedAt)) errors.push(p + '.fetchedAt 非法')
  if (!entry.effective || typeof entry.effective !== 'object') {
    errors.push(p + '.effective 缺失')
  } else {
    if (entry.effective.known !== true && entry.effective.known !== false) {
      errors.push(p + '.effective.known 必须是布尔')
    }
    if (entry.effective.from != null && !isTs(entry.effective.from)) errors.push(p + '.effective.from 非法')
    if (entry.effective.to != null && !isTs(entry.effective.to)) errors.push(p + '.effective.to 非法')
    // 生效时间未知时不得把抓取时间伪装成官方生效时间
    if (entry.effective.known === false && entry.effective.from != null) {
      errors.push(p + '.effective.known=false 时不得携带生效时间')
    }
  }
  if (entry.aliases != null) {
    if (!Array.isArray(entry.aliases)) errors.push(p + '.aliases 必须是数组')
    else {
      for (const a of entry.aliases) {
        if (!a || typeof a !== 'object' || !isId(a.id) || !Array.isArray(a.scope) || a.scope.length === 0) {
          errors.push(p + '.aliases 含非法项（需要 { id, scope: [platform...] }）')
          break
        }
      }
    }
  }
  if (!Array.isArray(entry.tiers) || entry.tiers.length === 0) {
    errors.push(p + '.tiers 必须是非空数组')
  } else {
    entry.tiers.forEach((tier, i) => {
      const tp = p + '.tiers[' + i + ']'
      if (!tier || typeof tier !== 'object') { errors.push(tp + ' 必须是对象'); return }
      if (tier.maxInputTokens != null && !(Number.isInteger(tier.maxInputTokens) && tier.maxInputTokens > 0)) {
        errors.push(tp + '.maxInputTokens 必须是正整数或 null')
      }
      if (tier.maxOutputTokens != null && !(Number.isInteger(tier.maxOutputTokens) && tier.maxOutputTokens > 0)) {
        errors.push(tp + '.maxOutputTokens 必须是正整数或 null')
      }
      if (tier.validFrom != null && !isTs(tier.validFrom)) errors.push(tp + '.validFrom 非法')
      if (tier.validTo != null && !isTs(tier.validTo)) errors.push(tp + '.validTo 非法')
      errors.push(...validatePriceRow(tier.prices, tp + '.prices'))
      if (tier.windows != null) {
        if (!Array.isArray(tier.windows) || tier.windows.length === 0) errors.push(tp + '.windows 必须是非空数组')
        else {
          for (const w of tier.windows) {
            if (!w || typeof w !== 'object' || !isId(w.id)) { errors.push(tp + '.windows 含非法项'); break }
            errors.push(...validatePriceRow(w.prices, tp + '.windows.' + (w && w.id) + '.prices'))
          }
        }
      }
    })
  }
  if (entry.completeness === 'partial') {
    if (!Array.isArray(entry.missing) || entry.missing.length === 0) {
      errors.push(p + " completeness='partial' 时必须列出 missing")
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * 来源块校验：来源状态 + 条目逐个校验。
 *
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateSourceBlock(block) {
  const errors = []
  if (!block || typeof block !== 'object') return { ok: false, errors: ['source 必须是对象'] }
  if (!isId(block.sourceId)) errors.push('source.sourceId 缺失')
  if (!isId(block.sourceUrl)) errors.push('source.sourceUrl 缺失')
  if (!['ok', 'unavailable', 'never'].includes(block.status)) errors.push('source.status 非法')
  const models = Array.isArray(block.models) ? block.models : []
  if (block.status === 'ok' && models.length === 0) errors.push("source.status='ok' 但没有任何模型条目")
  models.forEach((m, i) => {
    const r = validateModelEntry(m)
    if (!r.ok) errors.push(...r.errors.map((e) => 'models[' + i + ']: ' + e))
    else if (m.sourceId !== block.sourceId) errors.push('models[' + i + ']: sourceId 与来源块不一致')
  })
  return { ok: errors.length === 0, errors }
}

/**
 * 校验并归一整个目录。任何来源块不合法就整体拒绝（调用方保留上一次有效缓存）。
 *
 * @returns {{ ok: boolean, errors: string[], catalog: object|null }}
 */
export function normalizeCatalog(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['目录顶层必须是对象'], catalog: null }
  }
  const errors = []
  const sources = {}
  const src = raw.sources
  if (!src || typeof src !== 'object' || Array.isArray(src)) {
    return { ok: false, errors: ['目录缺少 sources'], catalog: null }
  }
  for (const [id, block] of Object.entries(src)) {
    if (!block || block.sourceId !== id) {
      errors.push('sources.' + id + '.sourceId 与键不一致')
      continue
    }
    const r = validateSourceBlock(block)
    if (!r.ok) errors.push(...r.errors.map((e) => 'sources.' + id + ': ' + e))
    else sources[id] = block
  }
  if (errors.length > 0) return { ok: false, errors, catalog: null }
  return {
    ok: true,
    errors: [],
    catalog: {
      catalogVersion: CATALOG_VERSION,
      updatedAt: Number(raw.updatedAt) || 0,
      sources
    }
  }
}

/**
 * 目录指纹：内容变化才 bump 版本，用于客户端增量刷新（stat 轻量探测）。
 * 只覆盖会影响金额的字段，抓取时间等元数据不参与。
 */
export function catalogFingerprint(catalog) {
  const parts = []
  const ids = Object.keys(catalog && catalog.sources ? catalog.sources : {}).sort()
  for (const id of ids) {
    const s = catalog.sources[id]
    parts.push(id + ':' + s.status + ':' + (s.priceVersion || ''))
    for (const m of s.models || []) {
      parts.push(JSON.stringify([m.officialModelId, m.unit, m.currency, m.tiers, m.effective]))
    }
  }
  let hash = 0
  const text = parts.join('|')
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  return hash
}

/**
 * 建一个空目录（五家来源都在，状态 never，等待首次刷新）。
 *
 * @param {Array<{sourceId:string, sourceUrl:string, vendor:string}>} defs
 */
export function emptyCatalog(defs) {
  const sources = {}
  for (const d of defs || []) {
    sources[d.sourceId] = {
      sourceId: d.sourceId,
      sourceUrl: d.sourceUrl,
      vendor: d.vendor || d.sourceId,
      status: 'never',
      lastAttemptAt: 0,
      lastSuccessAt: 0,
      lastError: '',
      priceVersion: '',
      models: [],
      rules: null,
      notes: []
    }
  }
  return { catalogVersion: CATALOG_VERSION, updatedAt: 0, sources }
}
