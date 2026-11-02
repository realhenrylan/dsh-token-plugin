/**
 * dsh-usage-plugin — 调用型号 → 官方型号的确定性映射。
 *
 * 规则（第一阶段硬约束）：
 *   1. 只做**显式、可追溯**的映射：官方型号 ID 与"已核实别名"精确匹配
 *      （大小写不敏感）；不做任意前缀裁剪、不做模糊匹配、不按相似度猜。
 *   2. 别名带平台范围（scope）：`'*'` 表示任意平台，否则必须命中调用平台
 *      （provider）才生效——第三方平台上的同名模型不一定是同一版本。
 *   3. 多个候选同时命中（不同官方型号）时判为歧义，宁可不计价也不猜。
 *
 * @module dsh-usage-plugin/pricing/resolver
 */

/** 归一化型号键：去空白 + 小写（仅用于查表，展示仍用原文）。 */
export function modelKey(model) {
  return String(model == null ? '' : model).trim().toLowerCase()
}

/**
 * 建别名索引：键为归一化型号，值为候选命中列表。
 *
 * @param catalog - 已校验的目录（见 catalog.js）。
 * @returns {Map<string, Array<{sourceId, officialModelId, basis, scope}>>}
 */
export function buildAliasIndex(catalog) {
  const index = new Map()
  const add = (key, hit) => {
    const list = index.get(key) || []
    if (!list.some((h) => h.sourceId === hit.sourceId && h.officialModelId === hit.officialModelId)) list.push(hit)
    index.set(key, list)
  }
  const sources = (catalog && catalog.sources) || {}
  for (const block of Object.values(sources)) {
    for (const entry of block.models || []) {
      add(modelKey(entry.officialModelId), {
        sourceId: entry.sourceId,
        officialModelId: entry.officialModelId,
        basis: 'official-id',
        scope: ['*']
      })
      for (const alias of entry.aliases || []) {
        add(modelKey(alias.id), {
          sourceId: entry.sourceId,
          officialModelId: entry.officialModelId,
          basis: 'alias:' + alias.id,
          scope: alias.scope
        })
      }
    }
  }
  return index
}

/**
 * 解析一次调用的模型。
 *
 * @param requestModel - 请求里出现的模型名（可能是第三方前缀名）。
 * @param provider - 调用平台 provider id（用于别名消歧，不参与选价）。
 * @param catalog - 已校验目录。
 * @param index - 可选，buildAliasIndex 的缓存结果。
 * @returns {{ status: 'matched'|'unknown_model'|'ambiguous', requestModel, provider,
 *            sourceId: string|null, officialModelId: string|null, basis: string,
 *            entry: object|null, note: string }}
 */
export function resolveModel(requestModel, provider, catalog, index) {
  const raw = String(requestModel == null ? '' : requestModel).trim()
  const key = modelKey(raw)
  const platform = String(provider == null ? '' : provider).trim().toLowerCase()
  const idx = index || buildAliasIndex(catalog)
  const candidates = idx.get(key) || []
  const scoped = candidates.filter((c) => {
    if (!Array.isArray(c.scope) || c.scope.length === 0) return false
    if (c.scope.indexOf('*') >= 0) return true
    return c.scope.some((s) => String(s).toLowerCase() === platform)
  })
  const base = {
    requestModel: raw,
    provider: platform,
    sourceId: null,
    officialModelId: null,
    basis: 'none',
    entry: null,
    note: ''
  }
  if (scoped.length === 0) {
    return {
      ...base,
      status: 'unknown_model',
      note: candidates.length > 0
        ? '型号仅在其它平台核实过（平台范围不含 ' + (platform || '未知') + '），不自动套用'
        : '目录中没有该型号的已核实映射'
    }
  }
  const distinct = new Map()
  for (const c of scoped) distinct.set(c.sourceId + '/' + c.officialModelId, c)
  if (distinct.size > 1) {
    return {
      ...base,
      status: 'ambiguous',
      note: '多个官方型号同时命中：' + Array.from(distinct.keys()).join('、') + '，不做猜测计价'
    }
  }
  const hit = scoped[0]
  const block = catalog.sources[hit.sourceId]
  const entry = (block && block.models ? block.models : [])
    .find((m) => m.officialModelId === hit.officialModelId) || null
  return {
    ...base,
    status: 'matched',
    sourceId: hit.sourceId,
    officialModelId: hit.officialModelId,
    basis: hit.basis,
    entry,
    note: entry ? '' : '命中来源但条目缺失'
  }
}
