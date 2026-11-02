/**
 * dsh-usage-plugin — 分来源价格缓存、刷新调度与状态。
 *
 * 状态机（每个官方来源独立，互不影响）：
 *   never →（首次刷新）→ ok | unavailable
 *   ok →（6 小时到期）→ 后台刷新 → ok（更新数据）| 保留旧数据 + 记失败
 *   距上次**成功**超过 24 小时 → 标记「价格可能过期」（stale）
 *   从未成功或无可靠数据 → 「暂无价格」
 *
 * 约束：
 *   - 刷新不阻塞模型流、记录写入与面板首开；对同一来源合并并发请求。
 *   - 失败退避有上限，绝不按模型调用频率重试。
 *   - 解析失败 / 结构异常**拒绝替换**上一次有效数据。
 *
 * @module dsh-usage-plugin/pricing/cache
 */

import { emptyCatalog, normalizeCatalog, catalogFingerprint, CATALOG_VERSION } from './catalog.js'

export const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 小时
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000 // 24 小时
const BACKOFF_BASE_MS = 5 * 60 * 1000 // 首次失败 5 分钟后重试
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000 // 退避上限 6 小时

/**
 * 创建价格缓存控制器。
 *
 * @param opts - `{ defs, sources, fetcher, now, onChange }`：
 *   defs: [{sourceId, sourceUrl, vendor}]；sources: 适配层注册表（含 fetchRaw/parse）；
 *   fetcher: 见 sources/common.js；now(): 可注入时钟（测试用）。
 */
export function createPricingCache(opts) {
  const defs = (opts && opts.defs) || []
  const adapters = (opts && opts.sources) || {}
  const fetcher = (opts && opts.fetcher) || null
  const now = (opts && opts.now) || (() => Date.now())
  const onChange = (opts && opts.onChange) || (() => {})

  const state = {
    catalog: emptyCatalog(defs),
    // 每来源的调度状态（不随 catalog 序列化进快照的运行时字段）
    runtime: {}
  }
  for (const d of defs) {
    state.runtime[d.sourceId] = { failures: 0, retryAfterAt: 0, inFlight: null, lastResult: '' }
  }

  function sourceState(id) {
    return state.catalog.sources[id] || null
  }

  function isStale(id) {
    const s = sourceState(id)
    if (!s || !s.lastSuccessAt) return true
    return now() - s.lastSuccessAt > STALE_AFTER_MS
  }

  function dueAt(id) {
    const s = sourceState(id)
    const rt = state.runtime[id]
    if (!s || !rt) return Infinity
    const base = s.lastSuccessAt ? s.lastSuccessAt + REFRESH_INTERVAL_MS : 0
    return Math.max(base, rt.retryAfterAt || 0)
  }

  function shouldRefresh(id) {
    return now() >= dueAt(id)
  }

  function nextDueAt() {
    let min = Infinity
    for (const id of Object.keys(state.runtime)) {
      const at = dueAt(id)
      if (at < min) min = at
    }
    return min
  }

  /**
   * 刷新一个来源。并发调用合并成一次请求（同一来源只允许一个 in-flight）。
   *
   * @returns {Promise<{sourceId, ok, error, replaced, at}>}
   */
  async function refreshOne(id, opts2) {
    const rt = state.runtime[id]
    const s = sourceState(id)
    const adapter = adapters[id]
    if (!rt || !s || !adapter) {
      return { sourceId: id, ok: false, error: '未知价格来源：' + id, replaced: false, at: now() }
    }
    const force = !!(opts2 && opts2.force)
    if (!force && now() < rt.retryAfterAt) {
      return { sourceId: id, ok: false, error: '退避重试中，稍后再试', replaced: false, at: now() }
    }
    if (rt.inFlight) return rt.inFlight
    rt.inFlight = (async () => {
      const at = now()
      s.lastAttemptAt = at
      let result = { sourceId: id, ok: false, error: '', replaced: false, at }
      try {
        const raw = await adapter.fetchRaw(fetcher)
        if (!raw || !raw.ok) {
          result.error = (raw && raw.error) || '读取失败'
        } else {
          const parsed = adapter.parse(raw)
          if (!parsed || parsed.ok !== true) {
            // 结构异常 / 解析器失配：拒绝替换上一次有效数据。
            result.error = (parsed && parsed.error) || '解析结果不合规范，已保留上一次有效价格'
          } else {
            const block = parsed.block
            block.lastAttemptAt = at
            block.lastSuccessAt = at
            block.lastError = ''
            block.priceVersion = block.priceVersion || String(at)
            const candidate = {
              catalogVersion: CATALOG_VERSION,
              updatedAt: at,
              sources: { ...state.catalog.sources, [id]: block }
            }
            const checked = normalizeCatalog(candidate)
            if (!checked.ok) {
              result.error = '校验失败，已保留上一次有效价格：' + checked.errors.slice(0, 3).join('；')
            } else {
              state.catalog = checked.catalog
              s2Fix(id, at)
              result.ok = true
              result.replaced = true
              rt.failures = 0
              rt.retryAfterAt = 0
              rt.lastResult = 'ok'
              onChange(id)
            }
          }
        }
      } catch (e) {
        result.error = String((e && e.message) || e)
      }
      if (!result.ok) {
        rt.failures += 1
        const backoff = Math.min(BACKOFF_BASE_MS * Math.pow(2, rt.failures - 1), BACKOFF_MAX_MS)
        rt.retryAfterAt = now() + backoff
        rt.lastResult = 'failed: ' + result.error
        const cur = sourceState(id)
        if (cur) {
          cur.lastAttemptAt = at
          cur.lastError = result.error
          if (cur.status === 'never') cur.status = 'unavailable'
        }
        onChange(id)
      }
      rt.inFlight = null
      return result
    })()
    return rt.inFlight
  }

  // 刷新成功后补齐来源块的运行时字段引用（normalizeCatalog 会重建对象）。
  function s2Fix(id, at) {
    const cur = state.catalog.sources[id]
    if (!cur) return
    const rt = state.runtime[id]
    cur.lastAttemptAt = at
    cur.lastSuccessAt = at
    cur.lastError = ''
    if (rt) rt.failures = 0
  }

  /** 批量刷新：`ids` 为空表示全部来源。单来源失败不影响其它来源。 */
  async function refresh(ids, opts2) {
    const list = Array.isArray(ids) && ids.length > 0
      ? ids.filter((id) => state.runtime[id])
      : Object.keys(state.runtime)
    const results = await Promise.all(list.map((id) => refreshOne(id, opts2)))
    return { ok: results.some((r) => r.ok), results, catalogVersion: catalogFingerprint(state.catalog) }
  }

  /** 启动时检查：没有缓存或距上次成功达到 6 小时的来源进入刷新队列。 */
  async function startupCheck() {
    const due = Object.keys(state.runtime).filter((id) => shouldRefresh(id))
    if (due.length === 0) return { refreshed: [], catalogVersion: catalogFingerprint(state.catalog) }
    const r = await refresh(due)
    return { refreshed: due, catalogVersion: r.catalogVersion }
  }

  /** 供持久化：导出可序列化状态。 */
  function snapshot() {
    return JSON.parse(JSON.stringify(state.catalog))
  }

  /**
   * 恢复持久化状态。结构异常时拒绝恢复（保持 never，等待刷新），
   * 绝不用坏数据替换当前状态。
   */
  function restore(raw) {
    const checked = normalizeCatalog(raw)
    if (!checked.ok) return { ok: false, errors: checked.errors }
    state.catalog = checked.catalog
    onChange(null)
    return { ok: true, errors: [] }
  }

  /** 每个来源的展示状态（供 /usage/api 的 pricingStatus）。 */
  function statuses() {
    const out = []
    for (const d of defs) {
      const s = sourceState(d.sourceId) || {}
      const stale = isStale(d.sourceId)
      out.push({
        sourceId: d.sourceId,
        vendor: d.vendor || d.sourceId,
        sourceUrl: d.sourceUrl,
        status: s.status || 'never',
        // state 用状态机取值（never/ok/unavailable/stale），供 UI 判断；
        // 文案在客户端按语言渲染，状态本身不带语言。无数据优先于过期。
        state: (s.models || []).length === 0 ? 'never' : stale ? 'stale' : (s.status || 'never'),
        unavailable: s.status === 'unavailable',
        available: (s.models || []).length > 0,
        modelCount: (s.models || []).length,
        lastAttemptAt: s.lastAttemptAt || 0,
        lastSuccessAt: s.lastSuccessAt || 0,
        lastError: s.lastError || '',
        lastResult: (state.runtime[d.sourceId] && state.runtime[d.sourceId].lastResult) || '',
        retryAfterAt: (state.runtime[d.sourceId] && state.runtime[d.sourceId].retryAfterAt) || 0,
        fetchedAt: s.fetchedAt || 0,
        stale
      })
    }
    return out
  }

  return {
    get catalog() { return state.catalog },
    catalogVersion: () => catalogFingerprint(state.catalog),
    refresh,
    refreshOne,
    startupCheck,
    shouldRefresh,
    nextDueAt,
    isStale,
    snapshot,
    restore,
    statuses
  }
}
