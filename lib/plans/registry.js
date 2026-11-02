const PLAN_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const CURRENCIES = new Set(['CNY', 'USD'])
const CYCLES = new Set(['month', 'year', 'week'])

const DEFAULT_PLANS = [
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    currency: 'USD',
    monthlyFee: 0,
    cycle: 'month',
    match: { providers: [], models: [], excludeUnmatched: false },
    sourceUrl: 'https://opencode.ai/v2/docs/console/go/',
    note: ''
  },
  {
    id: 'command-code-goat',
    name: 'Command Code GOAT',
    currency: 'USD',
    monthlyFee: 0,
    cycle: 'month',
    match: { providers: [], models: [], excludeUnmatched: false },
    sourceUrl: 'https://commandcode.ai/docs/plans/goat',
    note: ''
  }
]

export function defaultPlanRegistry() {
  return JSON.parse(JSON.stringify({ v: 1, plans: DEFAULT_PLANS }))
}

function stringList(value, { insensitive = false, max = 100 } = {}) {
  if (!Array.isArray(value) || value.length > max) return null
  const out = []
  const seen = new Set()
  for (const item of value) {
    if (typeof item !== 'string') return null
    const text = item.trim()
    if (!text || text.length > 200) return null
    const key = insensitive ? text.toLowerCase() : text
    if (!seen.has(key)) { seen.add(key); out.push(text) }
  }
  return out
}

export function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '套餐必须是对象' }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!PLAN_ID.test(id)) return { ok: false, error: '套餐 ID 只能使用小写字母、数字、点、下划线和连字符' }
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name || name.length > 120) return { ok: false, error: '套餐名称不能为空且不能超过 120 个字符' }
  const currency = typeof raw.currency === 'string' ? raw.currency.trim().toUpperCase() : ''
  if (!CURRENCIES.has(currency)) return { ok: false, error: '套餐币种目前只支持 CNY 和 USD' }
  if (typeof raw.monthlyFee !== 'number' || !Number.isFinite(raw.monthlyFee) || raw.monthlyFee < 0) {
    return { ok: false, error: '套餐费用必须是非负数字' }
  }
  const cycle = typeof raw.cycle === 'string' ? raw.cycle : ''
  if (!CYCLES.has(cycle)) return { ok: false, error: '计费周期必须是 month、year 或 week' }
  const sourceUrl = typeof raw.sourceUrl === 'string' ? raw.sourceUrl.trim() : ''
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return { ok: false, error: '来源链接必须以 http:// 或 https:// 开头' }
  const note = typeof raw.note === 'string' ? raw.note.trim() : ''
  if (note.length > 1000) return { ok: false, error: '备注不能超过 1000 个字符' }
  if (raw.match != null && (typeof raw.match !== 'object' || Array.isArray(raw.match))) {
    return { ok: false, error: '归因规则必须是对象' }
  }
  const match = raw.match || {}
  const providers = stringList(match.providers || [], { insensitive: true })
  const models = stringList(match.models || [])
  if (!providers || !models) return { ok: false, error: '归因 Provider ID 和模型列表必须是有效字符串数组' }
  if (match.excludeUnmatched != null && typeof match.excludeUnmatched !== 'boolean') {
    return { ok: false, error: '排除法归属必须是布尔值' }
  }
  return {
    ok: true,
    plan: {
      id, name, currency, monthlyFee: raw.monthlyFee, cycle,
      match: { providers, models, excludeUnmatched: match.excludeUnmatched === true },
      sourceUrl, note
    }
  }
}

export function normalizePlanRegistry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1 || !Array.isArray(raw.plans)) {
    return { ok: false, error: '套餐登记表格式无效' }
  }
  if (raw.plans.length > 100) return { ok: false, error: '套餐数量不能超过 100 个' }
  const plans = []
  const ids = new Set()
  for (const rawPlan of raw.plans) {
    const normalized = normalizePlan(rawPlan)
    if (!normalized.ok) return { ok: false, error: normalized.error }
    if (ids.has(normalized.plan.id)) return { ok: false, error: '套餐 ID 重复：' + normalized.plan.id }
    ids.add(normalized.plan.id)
    plans.push(normalized.plan)
  }
  return { ok: true, registry: { v: 1, plans } }
}

export function upsertPlan(registry, rawPlan) {
  const planResult = normalizePlan(rawPlan)
  if (!planResult.ok) return planResult
  const current = normalizePlanRegistry(registry)
  if (!current.ok) return current
  const plans = current.registry.plans.slice()
  const index = plans.findIndex((plan) => plan.id === planResult.plan.id)
  if (index >= 0) plans[index] = planResult.plan
  else plans.push(planResult.plan)
  return normalizePlanRegistry({ v: 1, plans })
}

export function deletePlan(registry, id) {
  const current = normalizePlanRegistry(registry)
  if (!current.ok) return current
  const planId = typeof id === 'string' ? id.trim() : ''
  return normalizePlanRegistry({ v: 1, plans: current.registry.plans.filter((plan) => plan.id !== planId) })
}
