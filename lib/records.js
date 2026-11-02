/**
 * dsh-usage-plugin — 用量记录归一化与身份判定（纯逻辑层，无副作用）。
 *
 * 两条原则：
 *   1. 归一化不猜测、不补造数据。上游没上报的字段就是 0，绝不用别的字段"兜底"
 *      填充——那会把口径污染成不可解释的数字（例如用未命中 token 冒充缓存写入，
 *      会让"四桶合计"凭空多出一笔）。
 *   2. 去重按"身份"而不是按"毫秒"。同一毫秒完全可能产生两条不同请求的记录，
 *      只按 time 去重会让它们互相覆盖、静默丢数据。
 *
 * @module dsh-usage-plugin/records
 */

/** 归一化会保留的字符串字段（缺省写空串，保持记录形状稳定）。 */
const STRING_FIELDS = ['model', 'provider', 'purpose', 'sessionId', 'finishReason', 'fxDate']

/**
 * 只在确实有值时才写入的标识字段。
 *
 * 旧记录没有它们，缺省必须"字段不存在"，而不是留下一个空串——空串会让
 * `recordKey` 的分支判断和"这条记录是哪来的"这类展示逻辑看起来像有值。
 */
const OPTIONAL_STRING_FIELDS = ['origin', 'recordId', 'mode']

/** 归一化会保留的非负计数字段。 */
const TOKEN_FIELDS = [
  'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens',
  'reasoningTokens', 'usdCnyRate', 'maxTokens', 'maxUses'
]

/** 归一化会保留的非负整数字段（宿主 turn/step/seq 语义）。 */
const INDEX_FIELDS = ['seq', 'turn', 'step', 'slotSeq']

/**
 * 把一条来自磁盘 / 导入文件 / 实时探针的原始数据归一化为插件内部记录。
 *
 * @param raw - 任意来源的候选记录。
 * @returns 归一化后的记录；缺少可用时间戳时返回 null（该条应被丢弃）。
 */
export function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const time = Number(raw.time)
  if (!Number.isFinite(time) || time <= 0) return null

  const rec = { time }
  for (const key of STRING_FIELDS) rec[key] = String(raw[key] || '')
  for (const key of OPTIONAL_STRING_FIELDS) {
    if (typeof raw[key] === 'string' && raw[key] !== '') rec[key] = raw[key]
  }
  for (const key of TOKEN_FIELDS) {
    const n = Number(raw[key])
    rec[key] = Number.isFinite(n) && n > 0 ? n : 0
  }
  rec.interrupted = !!raw.interrupted
  // 估算标记：为 true 时该记录的 token / 费用不是上游实测值，UI 与导出必须区分。
  if (raw.estimated) rec.estimated = true
  for (const key of INDEX_FIELDS) {
    if (Number.isSafeInteger(raw[key]) && raw[key] >= 0) rec[key] = raw[key]
  }
  // 计费时刻：记录发生时"生效的价格档"所对应的时刻。历史回填 / 导入的记录
  // 其 time 可能与真实调用时刻不同，用 pricingTime 冻结取价时点。
  if (Number.isFinite(raw.pricingTime) && raw.pricingTime > 0) rec.pricingTime = raw.pricingTime
  // 冻结单价快照：记录产生时实际用到的三个单价（元 / 百万 tokens）。
  // 有它，历史费用就不会因为后来改价格表被重算；没它（旧记录 / 手工导入）
  // 就退回用当前价格表计算，由 UI 另行提示。
  const unit = raw.unit
  if (unit && typeof unit === 'object') {
    const hit = Number(unit.hit)
    const miss = Number(unit.miss)
    const out = Number(unit.out)
    const any = [hit, miss, out].some((n) => Number.isFinite(n) && n >= 0)
    if (any) {
      const snapshot = {
        hit: Number.isFinite(hit) && hit > 0 ? hit : 0,
        miss: Number.isFinite(miss) && miss > 0 ? miss : 0,
        out: Number.isFinite(out) && out > 0 ? out : 0
      }
      const fx = Number(unit.fx)
      if (Number.isFinite(fx) && fx > 0) snapshot.fx = fx
      rec.unit = snapshot
    }
  }
  // 官方价快照（第一阶段）：记录产生时绑定的官方价格与规则坐标。
  // 与旧 `unit` 并存——旧记录继续按旧口径读取，绝不自动迁移。
  const ps = normalizePricingSnapshot(raw.pricingSnapshot)
  if (ps) rec.pricingSnapshot = ps
  return rec
}

/**
 * 归一化官方价快照（`pricingSnapshot`）。
 *
 * 只保留能支撑"冻结重算"的字段；形状不对就整个丢弃（宁可退回旧口径，
 * 也不留一份半截快照让金额无法解释）。金额为 null 表示当时就无法可靠计价，
 * 这个状态本身也要原样保留。
 *
 * @returns 归一化后的快照；无法识别时返回 null。
 */
export function normalizePricingSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.v !== 1) return null
  const sourceId = String(raw.sourceId || '')
  const officialModelId = String(raw.officialModelId || '')
  if (!sourceId || !officialModelId) return null
  const prices = {}
  if (!raw.prices || typeof raw.prices !== 'object') return null
  for (const key of ['input', 'cacheRead', 'cacheWrite', 'output']) {
    const v = raw.prices[key]
    if (v === null) { prices[key] = null; continue }
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) return null
    prices[key] = n
  }
  const status = String(raw.status || '')
  const snap = {
    v: 1,
    sourceId,
    officialModelId,
    requestModel: String(raw.requestModel || ''),
    provider: String(raw.provider || ''),
    basis: String(raw.basis || 'none'),
    currency: String(raw.currency || 'CNY'),
    unit: String(raw.unit || 'per_1m_tokens'),
    prices,
    status,
    missing: Array.isArray(raw.missing) ? raw.missing.map(String) : [],
    note: String(raw.note || '')
  }
  if (raw.region != null) snap.region = String(raw.region)
  if (raw.mode != null) snap.mode = String(raw.mode)
  if (raw.tierId != null) snap.tierId = String(raw.tierId)
  if (raw.windowId != null) snap.windowId = String(raw.windowId)
  if (raw.periodKind != null) snap.periodKind = String(raw.periodKind)
  if (Number.isFinite(Number(raw.fetchedAt)) && Number(raw.fetchedAt) > 0) snap.fetchedAt = Number(raw.fetchedAt)
  if (raw.priceVersion != null) snap.priceVersion = String(raw.priceVersion)
  const eff = raw.effective
  snap.effective = {
    known: !!(eff && eff.known),
    from: eff && eff.known && Number.isFinite(Number(eff.from)) ? Number(eff.from) : null,
    to: eff && eff.known && Number.isFinite(Number(eff.to)) ? Number(eff.to) : null
  }
  const fx = raw.fx
  if (fx && Number(fx.rate) > 0) {
    snap.fx = { rate: Number(fx.rate), source: String(fx.source || ''), date: String(fx.date || '') }
  }
  return snap
}

/**
 * 一条记录的身份键。
 *
 * 优先级：
 *   1. `recordId`——新探针写入的 UUID，天然唯一，直接用它。
 *   2. 扫描来源的 `(origin, sessionId, seq)`——宿主日志的 seq 即数组下标，稳定。
 *   3. 复合指纹——老记录没有上面两者，用"会话 + 时刻 + 模型 + 用途 + 四桶用量 +
 *      结束原因 + 中断标记"共同构成身份。比只按 time 安全：同毫秒的不同请求不会
 *      再互相覆盖，而真正的重复项仍能被识别出来。
 *
 * @param r - 归一化后的记录。
 * @returns 字符串身份键。
 */
export function recordKey(r) {
  if (r.recordId) return 'id:' + r.recordId
  if (r.origin === 'scan' && Number.isSafeInteger(r.seq)) return JSON.stringify(['scan', r.sessionId, r.seq])
  return JSON.stringify([
    r.sessionId || '', r.time, r.provider, r.model, r.purpose || '',
    r.origin || '', r.estimated === true,
    r.inputTokens || 0, r.outputTokens || 0, r.cacheReadTokens || 0, r.cacheWriteTokens || 0,
    r.reasoningTokens || 0, r.finishReason || '', !!r.interrupted
  ])
}

/**
 * 一条记录在展示层的"可计费 token 合计"。
 *
 * 口径（与 DSH 宿主 `TokenUsage` 一致，四桶互斥）：
 *   `未命中输入 + 缓存命中 + 缓存写入 + 输出`
 *
 * 注意 **不含 reasoningTokens**：宿主 `outputTokens` 就是上游的
 * `completion_tokens`，而 `reasoningTokens` 是它的子集（信息性字段）。
 * 把它再加一遍会让总数凭空多出一笔。
 *
 * @param r - 记录（已归一化或 API 投影形状均可）。
 * @returns 互斥四桶之和。
 */
export function billableTokens(r) {
  return (r.inputTokens || 0) + (r.cacheReadTokens || 0) + (r.cacheWriteTokens || 0) + (r.outputTokens || 0)
}
