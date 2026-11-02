import test from 'node:test'
import assert from 'node:assert/strict'
import { computeFromSnapshot, usageOf } from '../lib/pricing/engine.js'
import { normalizeRecord, billableTokens } from '../lib/records.js'
import { modelKeyOf } from '../lib/index.js'

// 统一为「模型开发方官方价」后的冻结规则：
// 记录产生时把当时生效的官方价快照（prices / currency / fx / status …）写进
// pricingSnapshot；之后一律用 computeFromSnapshot 照快照计算，不读当前目录。
// 因此目录更新、调价、汇率变化都不会改写历史金额。
//
// 用户反馈的核心 bug（旧实现）：价格表可实时修改，改完之后全部历史费用被重算。
// 现在由官方价快照承接这条保证。

const SNAPSHOT = {
  v: 1,
  sourceId: 'deepseek',
  officialModelId: 'deepseek-flash',
  requestModel: 'deepseek-flash',
  provider: 'deepseek-official',
  basis: 'official-id',
  currency: 'CNY',
  unit: 'per_1m_tokens',
  prices: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
  status: 'priced',
  missing: [],
  note: '',
  effective: { known: false, from: null, to: null }
}

test('a frozen official snapshot reproduces the official billing formula', () => {
  const usage = usageOf({ inputTokens: 1000, cacheReadTokens: 20000, cacheWriteTokens: 0, outputTokens: 500 })
  const r = computeFromSnapshot(SNAPSHOT, usage)
  assert.equal(r.status, 'priced')
  const expected = (1000 * 1 + 20000 * 0.02 + 500 * 4) / 1e6
  assert.ok(Math.abs(r.amountCny - expected) < 1e-9, String(r.amountCny))
})

test('the snapshot amount does not depend on the live price table', () => {
  const usage = usageOf({ inputTokens: 1000 })
  const first = computeFromSnapshot(SNAPSHOT, usage)
  // 快照里自带单价：之后再怎么调价也照原样重算
  const again = computeFromSnapshot(JSON.parse(JSON.stringify(SNAPSHOT)), usage)
  assert.equal(again.amountCny, first.amountCny)
  // 换了快照（新记录）才会按新价格计算
  const repriced = { ...SNAPSHOT, prices: { input: 2, cacheRead: 0.02, cacheWrite: 1, output: 4 } }
  assert.ok(computeFromSnapshot(repriced, usage).amountCny > first.amountCny)
})

test('a snapshot with incomplete prices reports missing instead of 0', () => {
  const usage = usageOf({ inputTokens: 10, cacheReadTokens: 10, cacheWriteTokens: 10, outputTokens: 5 })
  const snap = { ...SNAPSHOT, prices: { input: 1, cacheRead: null, cacheWrite: null, output: null } }
  const r = computeFromSnapshot(snap, usage)
  assert.equal(r.status, 'missing_price')
  assert.equal(r.amountCny, null)
  assert.deepEqual(r.missing, ['cacheRead', 'cacheWrite', 'output'])
})

test('a USD snapshot prices through its frozen fx rate', () => {
  const usage = usageOf({ inputTokens: 1_000_000 })
  const snap = {
    ...SNAPSHOT,
    currency: 'USD',
    prices: { input: 1, cacheRead: null, cacheWrite: null, output: null },
    fx: { rate: 7, source: 'Frankfurter', date: '2026-11-01' }
  }
  const r = computeFromSnapshot(snap, usage)
  assert.equal(r.status, 'priced')
  assert.ok(Math.abs(r.amountCny - 7) < 1e-9, String(r.amountCny))
})

test('a USD snapshot without an fx rate is flagged, never treated as 0', () => {
  const usage = usageOf({ inputTokens: 1_000_000 })
  const snap = { ...SNAPSHOT, currency: 'USD', prices: { input: 1, cacheRead: null, cacheWrite: null, output: null } }
  const r = computeFromSnapshot(snap, usage)
  assert.equal(r.status, 'missing_fx')
  assert.equal(r.amountCny, null)
})

test('records without an official snapshot are marked legacy, not zero', () => {
  const rec = normalizeRecord({
    time: 1, model: 'deepseek-flash', provider: 'deepseek-official', inputTokens: 100, outputTokens: 10
  })
  assert.equal('pricingSnapshot' in rec, false)
  const r = computeFromSnapshot(undefined, usageOf(rec))
  assert.equal(r.status, 'missing_rule')
  assert.equal(r.amountCny, null)
})

test('normalizeRecord keeps a frozen official snapshot and bills excluding reasoning', () => {
  const rec = normalizeRecord({
    time: 1,
    model: 'deepseek-flash',
    provider: 'deepseek-official',
    inputTokens: 100,
    outputTokens: 200,
    cacheReadTokens: 300,
    cacheWriteTokens: 0,
    reasoningTokens: 50,
    pricingSnapshot: SNAPSHOT
  })
  assert.deepEqual(rec.pricingSnapshot.prices, SNAPSHOT.prices)
  assert.equal(rec.pricingSnapshot.currency, 'CNY')
  // reasoningTokens(50) 已包含在 outputTokens(200) 内，不得另计
  assert.equal(billableTokens(rec), 600)
})

test('model ids still collapse onto the official pricing keys', () => {
  assert.equal(modelKeyOf('deepseek-flash'), 'deepseek-flash')
  assert.equal(modelKeyOf('deepseek-v4-flash'), 'deepseek-flash')
  assert.equal(modelKeyOf('deepseek-v4-flash-vision-exp'), 'deepseek-flash')
  assert.equal(modelKeyOf('deepseek-v4-pro'), 'deepseek-v4-pro')
  assert.equal(modelKeyOf('gpt-4o'), 'unknown')
})
