import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRecord, normalizePricingSnapshot, recordKey } from '../lib/records.js'

// 官方价快照（pricingSnapshot）的往返保证：
// JSON 导出／导入必须原样保存快照与状态——金额为 null 的"不可靠计算"、
// 缺项清单、规则注记都不能在往返中丢失或被补成 0。丢失会把"当时算不出来"
// 悄悄变成"当时免费"，这是计划明令禁止的口径污染。

const FULL_SNAPSHOT = {
  v: 1,
  sourceId: 'qwen',
  officialModelId: 'qwen3.6-27b',
  requestModel: 'qwen/qwen3.6-27b',
  provider: 'siliconflow',
  basis: 'verified-alias',
  currency: 'CNY',
  unit: 'per_1m_tokens',
  prices: { input: 3, cacheRead: 3, cacheWrite: 0, output: 18 },
  status: 'priced',
  missing: [],
  note: '',
  region: 'beijing',
  mode: 'standard',
  tierId: 'default',
  windowId: '',
  periodKind: 'flat',
  fetchedAt: 1793500000000,
  priceVersion: 'seed:verified:2026-11-01',
  effective: { known: false, from: null, to: null },
  fx: { rate: 7.2, source: 'manual', date: '2026-11-01' }
}

test('a full pricingSnapshot survives normalizeRecord unchanged', () => {
  const rec = normalizeRecord({
    time: 1793500000000,
    model: 'qwen/qwen3.6-27b',
    provider: 'siliconflow',
    inputTokens: 1000,
    outputTokens: 200,
    pricingSnapshot: FULL_SNAPSHOT
  })
  assert.ok(rec)
  assert.deepEqual(rec.pricingSnapshot, FULL_SNAPSHOT)
})

test('a snapshot with null prices stays null — never become 0 or 0-price', () => {
  const snap = normalizePricingSnapshot({
    ...FULL_SNAPSHOT,
    officialModelId: 'qwen-turbo',
    prices: { input: null, cacheRead: null, cacheWrite: null, output: null },
    status: 'missing_price',
    missing: ['input', 'output', 'cacheRead', 'cacheWrite'],
    note: '价格页未列出文本模型，不猜价'
  })
  assert.ok(snap)
  assert.equal(snap.prices.input, null)
  assert.equal(snap.prices.output, null)
  assert.deepEqual(snap.missing, ['input', 'output', 'cacheRead', 'cacheWrite'])
  assert.equal(snap.status, 'missing_price')
  assert.match(snap.note, /不猜价/)
})

test('a legally free price (explicit 0) is preserved as 0', () => {
  const snap = normalizePricingSnapshot({
    ...FULL_SNAPSHOT,
    officialModelId: 'glm-z1-flash',
    prices: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    status: 'free'
  })
  assert.ok(snap)
  assert.equal(snap.prices.input, 0)
  assert.equal(snap.prices.output, 0)
  assert.equal(snap.status, 'free')
})

test('malformed snapshots are dropped entirely, not half-kept', () => {
  assert.equal(normalizePricingSnapshot(null), null)
  assert.equal(normalizePricingSnapshot('nope'), null)
  assert.equal(normalizePricingSnapshot([]), null)
  assert.equal(normalizePricingSnapshot({ ...FULL_SNAPSHOT, v: 2 }), null)
  assert.equal(normalizePricingSnapshot({ ...FULL_SNAPSHOT, sourceId: '' }), null)
  assert.equal(normalizePricingSnapshot({ ...FULL_SNAPSHOT, officialModelId: '' }), null)
  assert.equal(normalizePricingSnapshot({ ...FULL_SNAPSHOT, prices: 'x' }), null)
  assert.equal(normalizePricingSnapshot({ ...FULL_SNAPSHOT, prices: { input: 1, output: 1 } }), null)
  assert.equal(normalizePricingSnapshot({ ...FULL_SNAPSHOT, prices: { ...FULL_SNAPSHOT.prices, input: Number.NaN } }), null)
  assert.equal(normalizePricingSnapshot({ ...FULL_SNAPSHOT, prices: { ...FULL_SNAPSHOT.prices, output: -1 } }), null)
})

test('unknown extra fields in a snapshot do not survive normalization', () => {
  const snap = normalizePricingSnapshot({ ...FULL_SNAPSHOT, garbageField: 'x', prices: { ...FULL_SNAPSHOT.prices, extraBucket: 9 } })
  assert.ok(snap)
  assert.equal('garbageField' in snap, false)
  assert.equal('extraBucket' in snap.prices, false)
})

test('a record without a snapshot keeps the field absent (legacy shape)', () => {
  const rec = normalizeRecord({ time: 1, model: 'm', provider: 'p', inputTokens: 1 })
  assert.equal('pricingSnapshot' in rec, false)
})

test('the snapshot is independent of the legacy unit snapshot', () => {
  const rec = normalizeRecord({
    time: 1, model: 'm', provider: 'p',
    unit: { hit: 0.02, miss: 1, out: 4 },
    pricingSnapshot: FULL_SNAPSHOT
  })
  assert.deepEqual(rec.unit, { hit: 0.02, miss: 1, out: 4 })
  assert.deepEqual(rec.pricingSnapshot, FULL_SNAPSHOT)
})

test('JSON stringify/parse round-trip keeps snapshot and status verbatim', () => {
  const rec = normalizeRecord({
    time: 1793500000000, model: 'm', provider: 'p', inputTokens: 1,
    pricingSnapshot: {
      ...FULL_SNAPSHOT,
      prices: { input: null, cacheRead: 3, cacheWrite: 0, output: 18 },
      status: 'missing_price',
      missing: ['input']
    }
  })
  const back = normalizeRecord(JSON.parse(JSON.stringify(rec)))
  assert.deepEqual(back.pricingSnapshot, rec.pricingSnapshot)
  assert.equal(back.pricingSnapshot.prices.input, null)
  assert.equal(back.pricingSnapshot.status, 'missing_price')
  assert.deepEqual(back.pricingSnapshot.missing, ['input'])
})

test('recordKey identity does not depend on the snapshot', () => {
  const base = { time: 1793500000000, model: 'm', provider: 'p', inputTokens: 1, outputTokens: 2 }
  const withSnap = normalizeRecord({ ...base, pricingSnapshot: FULL_SNAPSHOT })
  const withoutSnap = normalizeRecord(base)
  assert.equal(recordKey(withSnap), recordKey(withoutSnap))
})
