/**
 * dsh-usage-plugin — 官方来源读取的公共约束与校验（五家来源适配共用）。
 *
 * 安全边界（第一阶段硬约束）：
 *   1. 解析器只接受**预设官方 HTTPS 域名**；URL 不由模型名或外部内容拼接。
 *   2. 响应限大小、限超时、不跟随跳转（跳转目标不受控即视为失败）。
 *   3. 只获取价格所需信息；不上传对话内容、用量记录或任何服务商密钥。
 *   4. 解析失败 / 结构异常一律 `{ ok:false }`，由缓存层保留上一次有效数据。
 *
 * @module dsh-usage-plugin/pricing/sources/common
 */

export const SOURCE_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 20000,
  maxModels: 500
})

/** 价格数值校验：非负有限数字。 */
export function isPrice(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/**
 * 校验来源 URL：必须是 https、无凭据信息、主机在允许清单内
 * （允许清单是预设常量，不做后缀裁剪以外的匹配，也不接受 IP）。
 *
 * @param url - 待请求的 URL。
 * @param hosts - 允许的主机名数组（精确或子域）。
 * @returns {{ ok: boolean, error: string }}
 */
export function checkSourceUrl(url, hosts) {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch (e) {
    return { ok: false, error: '来源 URL 不合法' }
  }
  if (parsed.protocol !== 'https:') return { ok: false, error: '只允许 HTTPS 官方来源' }
  if (parsed.username || parsed.password) return { ok: false, error: '来源 URL 不得携带凭据' }
  const host = parsed.hostname.toLowerCase()
  const allowed = (hosts || []).some((h) => host === String(h).toLowerCase() || host.endsWith('.' + String(h).toLowerCase()))
  if (!allowed) return { ok: false, error: '主机不在官方来源允许清单内：' + host }
  return { ok: true, error: '' }
}

/**
 * 抓取一个官方来源。返回原文（限长），不做任何解析。
 *
 * @param fetcher - `{ get(url, headers, timeoutMs) -> { ok, statusCode, contentType, body, error } }`。
 * @param spec - `{ sourceId, url, hosts }`。
 * @returns `{ ok, body, contentType, statusCode, error }`。
 */
export async function fetchSource(fetcher, spec) {
  const check = checkSourceUrl(spec.url, spec.hosts)
  if (!check.ok) return { ok: false, error: check.error }
  let res
  try {
    res = await fetcher.get(spec.url, { Accept: 'text/html,application/json', 'User-Agent': 'dsh-usage-plugin' }, SOURCE_LIMITS.timeoutMs)
  } catch (e) {
    return { ok: false, error: '请求失败：' + String((e && e.message) || e) }
  }
  if (!res || !res.ok) return { ok: false, error: (res && res.error) || '请求失败' }
  if (res.statusCode !== 200) return { ok: false, error: 'HTTP ' + res.statusCode }
  const body = String(res.body == null ? '' : res.body)
  if (body.length > SOURCE_LIMITS.maxBytes) {
    return { ok: false, error: '响应超过 ' + SOURCE_LIMITS.maxBytes + ' 字节上限，拒绝解析' }
  }
  return { ok: true, body, contentType: String(res.contentType || ''), statusCode: res.statusCode }
}

/**
 * 结构化样本（官方结构化接口或已保存的核验样本）→ 来源块。
 *
 * 输入形状见 docs/source-verification/ 下各样本；输出形状由 catalog.js 校验。
 * 这里只做**确定性字段转换**，不做任何补值：样本缺项就落到 completeness='partial'。
 *
 * @param payload - `{ sourceId, sourceUrl, ok, models, rules, notes, fetchedAt }`。
 * @param normalizeModel - 每家适配自带的字段转换函数。
 * @returns `{ ok, block, errors }`。
 */
export function buildSourceBlock(payload, normalizeModel) {
  const errors = []
  if (!payload || typeof payload !== 'object') return { ok: false, errors: ['样本不是对象'], block: null }
  if (payload.ok !== true) {
    return { ok: false, errors: [String(payload.error || '来源标记为不可用')], block: null }
  }
  if (!Array.isArray(payload.models)) return { ok: false, errors: ['样本缺少 models'], block: null }
  if (payload.models.length > SOURCE_LIMITS.maxModels) return { ok: false, errors: ['模型数量超过上限'], block: null }
  const models = []
  for (let i = 0; i < payload.models.length; i++) {
    let entry
    try {
      entry = normalizeModel(payload.models[i], payload)
    } catch (e) {
      errors.push('models[' + i + '] 转换失败：' + String((e && e.message) || e))
      continue
    }
    if (!entry) { errors.push('models[' + i + '] 无法识别'); continue }
    models.push(entry)
  }
  if (models.length === 0) return { ok: false, errors: errors.length ? errors : ['没有可用模型条目'], block: null }
  return {
    ok: true,
    errors,
    block: {
      sourceId: payload.sourceId,
      sourceUrl: payload.sourceUrl,
      vendor: payload.vendor || payload.sourceId,
      status: 'ok',
      fetchedAt: Number(payload.fetchedAt) || Date.now(),
      models,
      rules: payload.rules && typeof payload.rules === 'object' ? payload.rules : null,
      notes: Array.isArray(payload.notes) ? payload.notes.map(String) : []
    }
  }
}

/** 别名归一：字符串数组或 { id, scope } 数组都接受，统一成对象。 */
export function normalizeAliases(raw, defaultScope) {
  const list = []
  for (const a of Array.isArray(raw) ? raw : []) {
    if (typeof a === 'string') {
      if (a.trim()) list.push({ id: a.trim(), scope: defaultScope || ['*'] })
    } else if (a && typeof a === 'object' && a.id) {
      list.push({ id: String(a.id).trim(), scope: Array.isArray(a.scope) && a.scope.length ? a.scope.map(String) : (defaultScope || ['*']) })
    }
  }
  return list
}

/** 生效区间归一：`effectiveFrom`/`effectiveTo`（ISO 字符串或毫秒）→ `{known, from, to}`。 */
export function normalizeEffective(from, to) {
  const parse = (v) => {
    if (v == null || v === '') return null
    const ts = typeof v === 'number' ? v : Date.parse(v)
    return Number.isFinite(ts) && ts > 0 ? ts : null
  }
  const f = parse(from)
  const t = parse(to)
  if (f == null && t == null) return { known: false, from: null, to: null }
  return { known: true, from: f, to: t }
}

// ── 文本/表格抽取原语（markdown 与 HTML 表格都适用） ─────────────────────

/** 去掉 HTML 标签与常见装饰，只留文本。 */
export function stripTags(text) {
  return String(text == null ? '' : text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{\/\*[^*]*\*\/\}/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
}

/** 把一行 markdown / HTML 表格拆成单元格文本。 */
export function splitRowCells(line) {
  return stripTags(line)
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c !== '')
}

/** 抽出文本里的金额数字（如 "¥0.025"、"13.5元"、"$0.435"、"68.00"）。 */
export function extractMoney(text) {
  const out = []
  const re = /(?:¥|＄|\$|￥|元|CNY|USD)?\s*([0-9]+(?:\.[0-9]+)?)/g
  const s = String(text == null ? '' : text)
  let m
  while ((m = re.exec(s)) !== null) out.push(Number(m[1]))
  return out
}

/** 抽出代码块里的模型 id（`deepseek-flash` 这类）。 */
export function extractModelIds(text) {
  const out = []
  const re = /`([a-zA-Z0-9][a-zA-Z0-9._\-\/]{1,80})`/g
  const s = String(text == null ? '' : text)
  let m
  while ((m = re.exec(s)) !== null) {
    const id = m[1]
    if (/^[a-zA-Z0-9._\-\/]+$/.test(id)) out.push(id)
  }
  return out
}

/**
 * 表格行抽取：返回每行的 `{ cells, ids, numbers }`。
 * markdown（`|` 分隔）与 HTML（`<tr><td>`）两种表都覆盖。
 */
export function tableRows(text) {
  const s = String(text == null ? '' : text)
  const rows = []
  const htmlRows = s.match(/<tr[\s\S]*?<\/tr>/gi) || []
  const seen = new Set()
  for (const r of htmlRows) {
    seen.add(r)
    rows.push(rowFromText(r))
  }
  for (const line of s.split(/\r?\n/)) {
    if (line.indexOf('|') < 0) continue
    if (/^\s*\|?\s*:?-{2,}/.test(line)) continue // 表头分隔行
    if (htmlRows.some((h) => h.indexOf(line.trim()) >= 0 && line.trim().length > 20)) continue
    rows.push(rowFromText(line))
  }
  return rows.filter((r) => r.cells.length > 0 || r.ids.length > 0)
}

function rowFromText(text) {
  const cells = splitRowCells(text)
  return { cells, ids: extractModelIds(text), numbers: extractMoney(stripTags(text)) }
}
