/**
 * Match a call to a registered plan without inferring from model names alone.
 * Provider ids are case-insensitive; model ids are exact and case-sensitive.
 */
export function matchPlanChannel(call, plans) {
  const provider = String(call && call.provider || '').trim()
  const model = String(call && call.model || '').trim()
  if (!provider) return { channel: null, reason: 'missing-provider', matches: [] }
  const rows = Array.isArray(plans) ? plans : (plans && Array.isArray(plans.plans) ? plans.plans : [])
  const providerKey = provider.toLowerCase()
  const matches = []
  for (const plan of rows) {
    const match = plan && plan.match || {}
    const providers = Array.isArray(match.providers) ? match.providers : []
    if (!providers.some((item) => String(item).trim().toLowerCase() === providerKey)) continue
    const models = Array.isArray(match.models) ? match.models : []
    if (models.length && !models.includes(model)) continue
    matches.push({ plan, basis: 'provider:' + provider + (models.length ? ';model:' + model : '') })
  }
  if (matches.length > 1) return { channel: null, reason: 'ambiguous', matches: matches.map((item) => item.plan.id) }
  if (matches.length === 1) {
    const hit = matches[0]
    return { channel: { v: 1, kind: 'plan', planId: hit.plan.id, basis: hit.basis }, reason: 'matched', matches: [hit.plan.id] }
  }
  const fallbacks = rows.filter((plan) => plan && plan.match && plan.match.excludeUnmatched === true)
  if (fallbacks.length > 1) return { channel: null, reason: 'ambiguous-fallback', matches: fallbacks.map((item) => item.id) }
  if (fallbacks.length === 1) {
    return { channel: { v: 1, kind: 'per_token', basis: 'exclude-unmatched:' + fallbacks[0].id }, reason: 'excluded', matches: [] }
  }
  return { channel: null, reason: 'unmatched', matches: [] }
}
