import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultPlanRegistry, deletePlan, normalizePlan, normalizePlanRegistry, upsertPlan } from '../lib/plans/registry.js'
import { matchPlanChannel } from '../lib/plans/match.js'
import { calculatePlanRoi, monthlyFeeCny } from '../lib/plans/roi.js'

function plan(overrides = {}) {
  return {
    id: 'sample-plan', name: 'Sample Plan', currency: 'CNY', monthlyFee: 40,
    cycle: 'month', match: { providers: ['plan-route'], models: [], excludeUnmatched: false },
    sourceUrl: '', note: '', ...overrides
  }
}

test('default plans leave provider ids empty until the DSH routes are verified', () => {
  const registry = defaultPlanRegistry()
  assert.deepEqual(registry.plans.map((item) => item.id), ['opencode-go', 'command-code-goat'])
  assert.ok(registry.plans.every((item) => item.monthlyFee === 0 && item.match.providers.length === 0))
})

test('plan normalization validates currency, cycle, urls, ids and match shape', () => {
  assert.equal(normalizePlan(plan()).ok, true)
  assert.equal(normalizePlan(plan({ currency: 'EUR' })).ok, false)
  assert.equal(normalizePlan(plan({ cycle: 'quarter' })).ok, false)
  assert.equal(normalizePlan(plan({ sourceUrl: 'javascript:alert(1)' })).ok, false)
  assert.equal(normalizePlan(plan({ match: 'plan-route' })).ok, false)
  assert.equal(normalizePlan(plan({ monthlyFee: -1 })).ok, false)
})

test('registry rejects duplicate ids and updates or deletes without mutating input', () => {
  const first = normalizePlanRegistry({ v: 1, plans: [plan()] })
  assert.equal(first.ok, true)
  const duplicate = normalizePlanRegistry({ v: 1, plans: [plan(), plan({ name: 'Duplicate' })] })
  assert.equal(duplicate.ok, false)
  const updated = upsertPlan(first.registry, plan({ name: 'Renamed' }))
  assert.equal(updated.registry.plans[0].name, 'Renamed')
  assert.equal(first.registry.plans[0].name, 'Sample Plan')
  assert.deepEqual(deletePlan(updated.registry, 'sample-plan').registry.plans, [])
})

test('plan matching requires an exact provider and only applies listed models', () => {
  const rows = [plan({ match: { providers: ['Plan-Route'], models: ['model-1'], excludeUnmatched: false } })]
  assert.equal(matchPlanChannel({ provider: 'plan-route', model: 'model-1' }, rows).channel.planId, 'sample-plan')
  assert.equal(matchPlanChannel({ provider: 'plan-route', model: 'model-2' }, rows).channel, null)
  assert.equal(matchPlanChannel({ provider: 'other-route', model: 'model-1' }, rows).channel, null)
  assert.equal(matchPlanChannel({ provider: '', model: 'model-1' }, rows).channel, null)
})

test('model name alone never identifies a plan; overlap is left unmarked', () => {
  const first = plan({ match: { providers: ['one'], models: [], excludeUnmatched: false } })
  const second = plan({ id: 'other-plan', match: { providers: ['two'], models: [], excludeUnmatched: false } })
  assert.equal(matchPlanChannel({ provider: 'unknown-route', model: 'same-model' }, [first, second]).reason, 'unmatched')
  assert.equal(matchPlanChannel({ provider: 'one', model: 'same-model' }, [first, second]).channel.planId, 'sample-plan')
  const overlap = [first, plan({ id: 'third-plan', match: { providers: ['ONE'], models: [], excludeUnmatched: false } })]
  assert.equal(matchPlanChannel({ provider: 'one', model: 'same-model' }, overlap).reason, 'ambiguous')
  assert.equal(matchPlanChannel({ provider: 'one', model: 'same-model' }, overlap).channel, null)
})

test('per-token attribution requires one explicit exclusion rule', () => {
  const only = plan({ match: { providers: [], models: [], excludeUnmatched: true } })
  assert.deepEqual(matchPlanChannel({ provider: 'ordinary', model: 'm' }, [only]).channel, {
    v: 1, kind: 'per_token', basis: 'exclude-unmatched:sample-plan'
  })
  assert.equal(matchPlanChannel({ provider: 'ordinary', model: 'm' }, [only, plan({ id: 'another', match: { providers: [], models: [], excludeUnmatched: true } })]).channel, null)
})

test('monthly fee conversion handles month, year, week, USD and missing FX', () => {
  assert.equal(monthlyFeeCny(plan({ monthlyFee: 120, cycle: 'year' })), 10)
  assert.ok(Math.abs(monthlyFeeCny(plan({ monthlyFee: 43.45, cycle: 'week' })) - 10) < 1e-9)
  assert.equal(monthlyFeeCny(plan({ monthlyFee: 10, currency: 'USD' }), 7), 70)
  assert.equal(monthlyFeeCny(plan({ monthlyFee: 10, currency: 'USD' })), null)
  assert.equal(monthlyFeeCny(plan({ monthlyFee: 0 })), null)
})

test('ROI keeps unregistered fees and missing exchange rates distinct', () => {
  assert.equal(calculatePlanRoi(plan({ monthlyFee: 0 }), 100, 7).status, 'unregistered')
  assert.equal(calculatePlanRoi(plan({ monthlyFee: 10, currency: 'USD' }), 100).status, 'fx-unavailable')
  const ready = calculatePlanRoi(plan({ monthlyFee: 40 }), 100)
  assert.equal(ready.ratio, 2.5)
  assert.equal(ready.differenceCny, 60)
})
