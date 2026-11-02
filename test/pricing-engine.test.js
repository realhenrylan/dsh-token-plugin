import test from 'node:test'
import assert from 'node:assert/strict'
import {
  priceCall,
  usageOf,
  selectTier,
  periodWindowAt,
  buildSnapshot,
  computeFromSnapshot,
  costNano,
  nanoToNumber
} from '../lib/pricing/engine.js'
import { holidayRule } from '../lib/pricing/holidays.js'

// 第一阶段计价引擎回归：分档 / 峰谷 / 缓存桶语义 / 结构化状态 /
// 冻结快照。金额口径：null = 无法可靠计算；0 只表示官方明确免费。

const BJ = (s) => Date.parse(s)

function deepseekEntry() {
  return {
    sourceId: 'deepseek',
    officialModelId: 'deepseek-flash',
    currency: 'CNY',
    unit: 'per_1m_tokens',
    cache: { readFallbackToInput: false, writeBilledAs: 'unknown' },
    periods: {
      kind: 'peak-valley',
      timeZone: 'Asia/Shanghai',
      peakWindows: [[540, 720], [840, 1080]],
      weekendFlatFrom: 0,
      holidayFlatFrom: 0,
      holidays: holidayRule()
    },
    tiers: [
      {
        id: 'v41',
        validFrom: BJ('2026-09-10T12:00:00+08:00'),
        windows: [
          { id: 'offPeak', prices: { input: 1, cacheRead: 0.02, output: 4 } },
          { id: 'peak', prices: { input: 2, cacheRead: 0.04, output: 8 } }
        ]
      }
    ],
    effective: { known: true, from: BJ('2026-09-10T12:00:00+08:00'), to: null },
    fetchedAt: 1,
    completeness: 'full',
    missing: []
  }
}

test('period windows: weekday peak blocks, weekend and holiday are off-peak', () => {
  const periods = deepseekEntry().periods
  assert.equal(periodWindowAt(periods, BJ('2026-11-02T10:00:00+08:00')).windowId, 'peak') // 周一上午
  assert.equal(periodWindowAt(periods, BJ('2026-11-02T13:00:00+08:00')).windowId, 'offPeak') // 午休
  assert.equal(periodWindowAt(periods, BJ('2026-11-02T14:30:00+08:00')).windowId, 'peak') // 周一下午
  assert.equal(periodWindowAt(periods, BJ('2026-11-01T10:00:00+08:00')).windowId, 'offPeak') // 周日
  assert.equal(periodWindowAt(periods, BJ('2026-10-01T10:00:00+08:00')).windowId, 'offPeak') // 国庆
  // 跨午夜：23:30 → 00:30 都是空闲段
  assert.equal(periodWindowAt(periods, BJ('2026-11-02T23:30:00+08:00')).windowId, 'offPeak')
  assert.equal(periodWindowAt(periods, BJ('2026-11-03T00:30:00+08:00')).windowId, 'offPeak')
})

test('a holiday year outside calendar coverage is an incomplete rule, not an assumption', () => {
  const periods = deepseekEntry().periods
  const r = periodWindowAt(periods, BJ('2027-01-01T10:00:00+08:00'))
  assert.equal(r.windowId, null)
  assert.equal(r.incomplete, true)
  const priced = priceCall({
    entry: deepseekEntry(),
    usage: usageOf({ inputTokens: 1000 }),
    at: BJ('2027-01-01T10:00:00+08:00'),
    mode: 'standard'
  })
  assert.equal(priced.status, 'missing_rule')
  assert.equal(priced.amountCny, null)
  assert.ok(priced.note.indexOf('2026') >= 0)
})

test('peak/off-peak prices are selected by call time', () => {
  const entry = deepseekEntry()
  const usage = usageOf({ inputTokens: 1000000, cacheReadTokens: 0, outputTokens: 0 })
  const peak = priceCall({ entry, usage, at: BJ('2026-11-02T09:30:00+08:00'), mode: 'standard' })
  assert.equal(peak.windowId, 'peak')
  assert.equal(peak.amountCny, 2)
  const off = priceCall({ entry, usage, at: BJ('2026-11-02T21:30:00+08:00'), mode: 'standard' })
  assert.equal(off.windowId, 'offPeak')
  assert.equal(off.amountCny, 1)
})

test('a call outside every verified price era is not priced', () => {
  const entry = deepseekEntry()
  const r = priceCall({ entry, usage: usageOf({ inputTokens: 1 }), at: BJ('2026-09-01T10:00:00+08:00'), mode: 'standard' })
  assert.equal(r.status, 'missing_rule')
  assert.ok(r.note.indexOf('生效区间') >= 0)
})

test('unknown model and missing usage are distinct unpriced states', () => {
  const unknown = priceCall({ entry: null, usage: usageOf({ inputTokens: 1 }), at: Date.now() })
  assert.equal(unknown.status, 'unknown_model')
  assert.equal(unknown.amountCny, null)
  const noUsage = priceCall({ entry: deepseekEntry(), usage: usageOf({}), at: BJ('2026-11-02T10:00:00+08:00') })
  assert.equal(noUsage.status, 'missing_usage')
})

test('a bucket with usage but no price is partial, never silently zero', () => {
  const entry = deepseekEntry()
  entry.periods = null
  entry.tiers = [{ id: 'standard', maxInputTokens: null, maxOutputTokens: null, prices: { input: 1, cacheRead: 0.02, output: 4 } }]
  const r = priceCall({ entry, usage: usageOf({ inputTokens: 100, cacheWriteTokens: 50 }), at: Date.now(), mode: 'standard' })
  assert.equal(r.status, 'missing_price')
  assert.equal(r.partial, true)
  assert.equal(r.amountCny, null)
  assert.deepEqual(r.missing, ['cacheWrite'])
})

test('confirmed free models price as 0 (not unknown)', () => {
  const entry = {
    ...deepseekEntry(),
    periods: null,
    tiers: [{ id: 'free', prices: { input: 0, cacheRead: 0, output: 0 } }]
  }
  const r = priceCall({ entry, usage: usageOf({ inputTokens: 1000, outputTokens: 10 }), at: Date.now(), mode: 'standard' })
  assert.equal(r.status, 'free')
  assert.equal(r.amountCny, 0)
})

test('GLM-style joint input×output tiers refuse to guess when output is unknown', () => {
  const entry = {
    sourceId: 'glm',
    officialModelId: 'glm-4.7',
    currency: 'CNY',
    unit: 'per_1m_tokens',
    cache: { readFallbackToInput: false, writeBilledAs: 'unknown' },
    periods: null,
    tiers: [
      { id: 'in≤32k,out<0.2k', maxInputTokens: 32000, maxOutputTokens: 200, prices: { input: 2, cacheRead: 0.4, output: 8 } },
      { id: 'in≤32k', maxInputTokens: 32000, maxOutputTokens: null, prices: { input: 3, cacheRead: 0.6, output: 14 } },
      { id: 'in≤200k', maxInputTokens: 200000, maxOutputTokens: null, prices: { input: 4, cacheRead: 0.8, output: 16 } }
    ],
    effective: { known: false, from: null, to: null },
    fetchedAt: 1,
    completeness: 'full',
    missing: []
  }
  const pick = (input, output) => selectTier(entry, usageOf({ inputTokens: input, outputTokens: output }), null, Date.now())
  assert.equal(pick(10000, 100).tier.id, 'in≤32k,out<0.2k')
  assert.equal(pick(10000, 500).tier.id, 'in≤32k')
  assert.equal(pick(50000, 100).tier.id, 'in≤200k')
  const noOutput = pick(10000, 0)
  assert.equal(noOutput.tier, null)
  assert.ok(noOutput.reason.indexOf('联合档位') >= 0)
  const r = priceCall({ entry, usage: usageOf({ inputTokens: 10000 }), at: Date.now(), mode: null })
  assert.equal(r.status, 'missing_rule')
})

test('Qwen-style length tiers pick the first fitting tier at exact boundaries', () => {
  const entry = {
    sourceId: 'qwen',
    officialModelId: 'qwen-plus',
    currency: 'CNY',
    unit: 'per_1m_tokens',
    cache: { readFallbackToInput: false, writeBilledAs: 'unknown' },
    periods: null,
    tiers: [
      { id: 't1', maxInputTokens: 128000, prices: { input: 0.8, output: 2 } },
      { id: 't2', maxInputTokens: 256000, prices: { input: 2.4, output: 20 } }
    ],
    effective: { known: false, from: null, to: null },
    fetchedAt: 1,
    completeness: 'full',
    missing: []
  }
  const at = (tokens) => selectTier(entry, usageOf({ inputTokens: tokens, outputTokens: 1 }), null, Date.now()).tier
  assert.equal(at(128000).id, 't1')
  assert.equal(at(128001).id, 't2')
  assert.equal(at(256001), null) // 超出所有档位 → 不猜
})

test('Kimi TTL-tiered cache write uses the official default TTL and says so', () => {
  const entry = {
    sourceId: 'kimi',
    officialModelId: 'kimi-k3',
    currency: 'CNY',
    unit: 'per_1m_tokens',
    cache: { readFallbackToInput: false, writeBilledAs: 'unknown', writeTtlDefault: 'ttl5m' },
    periods: null,
    tiers: [{ id: 'standard', prices: { input: 20, cacheRead: 2, cacheWrite: { ttl5m: 20, ttl1h: 40 }, output: 100 } }],
    effective: { known: false, from: null, to: null },
    fetchedAt: 1,
    completeness: 'full',
    missing: []
  }
  const usage = usageOf({ inputTokens: 1000, cacheWriteTokens: 1000, outputTokens: 0 })
  const def = priceCall({ entry, usage, at: Date.now(), mode: 'standard' })
  assert.equal(def.amountCny, 0.04)
  assert.equal(def.estimated, true)
  assert.ok(def.assumptions[0].indexOf('ttl5m') >= 0)
  const oneHour = priceCall({ entry, usage, at: Date.now(), mode: 'standard', cacheTtl: 'ttl1h' })
  assert.equal(oneHour.amountCny, 0.06)
  assert.equal(oneHour.estimated, false)
})

test('MiMo models are distinguished: no flash/pro substring matching', () => {
  // 三个型号价差 10 倍：引擎按条目选价，不做名字相似度匹配。
  const mk = (id, hit, miss, out) => ({
    sourceId: 'mimo', officialModelId: id, currency: 'CNY', unit: 'per_1m_tokens',
    cache: { readFallbackToInput: false, writeBilledAs: 'separate' }, periods: null,
    tiers: [{ id: 'standard', prices: { input: miss, cacheRead: hit, cacheWrite: 0, output: out } }],
    effective: { known: true, from: 1, to: null }, fetchedAt: 1, completeness: 'full', missing: []
  })
  const usage = usageOf({ inputTokens: 1000000, outputTokens: 0 })
  const flash = priceCall({ entry: mk('mimo-v2.6-flash', 0.02, 1, 2), usage, at: Date.now(), mode: 'standard' })
  const ultra = priceCall({ entry: mk('mimo-v2.6-pro-ultraspeed', 0.25, 30, 60), usage, at: Date.now(), mode: 'standard' })
  assert.equal(flash.amountCny, 1)
  assert.equal(ultra.amountCny, 30)
})

test('unknown channel with a batch tier is not marked as estimated', () => {
  const entry = {
    sourceId: 'mimo', officialModelId: 'mimo-v2.6-pro', currency: 'CNY', unit: 'per_1m_tokens',
    cache: { readFallbackToInput: false, writeBilledAs: 'separate' }, periods: null,
    tiers: [
      { id: 'standard', prices: { input: 3, cacheRead: 0.025, cacheWrite: 0, output: 6 } },
      { id: 'batch', mode: 'batch', prices: { input: 1.5, cacheRead: 0.0125, cacheWrite: 0, output: 3 } }
    ],
    effective: { known: true, from: 1, to: null }, fetchedAt: 1, completeness: 'full', missing: []
  }
  const r = priceCall({ entry, usage: usageOf({ inputTokens: 1000000, outputTokens: 0 }), at: Date.now(), mode: null })
  assert.equal(r.amountCny, 3)
  assert.equal(r.estimated, false)
  assert.deepEqual(r.assumptions, [])
})

test('non-token items and unsplit bucket semantics are never run through the token formula', () => {
  const excluded = {
    sourceId: 'mimo', officialModelId: 'mimo-v2.5-asr', currency: 'CNY', unit: 'per_hour_input_audio',
    pricingExcluded: true, bucketSemantics: 'unsplit', cache: {}, periods: null,
    tiers: [{ id: 'excluded', prices: {} }],
    effective: { known: false, from: null, to: null }, fetchedAt: 1, completeness: 'partial', missing: ['non_token_unit']
  }
  const r = priceCall({ entry: excluded, usage: usageOf({ inputTokens: 999 }), at: Date.now() })
  assert.equal(r.status, 'missing_rule')
  assert.equal(r.amountCny, null)
  assert.ok(r.note.indexOf('未覆盖') >= 0)
})

test('a non-CNY entry without an FX rate reports missing_fx instead of ¥0', () => {
  const entry = {
    sourceId: 'x', officialModelId: 'usd-model', currency: 'USD', unit: 'per_1m_tokens',
    cache: {}, periods: null,
    tiers: [{ id: 'standard', prices: { input: 1, output: 2 } }],
    effective: { known: true, from: 1, to: null }, fetchedAt: 1, completeness: 'full', missing: []
  }
  const usage = usageOf({ inputTokens: 1000000, outputTokens: 0 })
  const noFx = priceCall({ entry, usage, at: Date.now(), mode: 'standard' })
  assert.equal(noFx.status, 'missing_fx')
  assert.equal(noFx.amountCny, null)
  assert.equal(noFx.amountOriginal, 1)
  const withFx = priceCall({ entry, usage, at: Date.now(), mode: 'standard', fxRate: 7.2 })
  assert.equal(withFx.status, 'priced')
  assert.equal(withFx.amountCny, 7.2)
})

test('fixed-point math keeps tiny amounts exact and aggregation-stable', () => {
  // 0.02 元/百万 × 500,000 tokens = 0.01 元，一千次累加必须正好 10 元。
  let total = 0n
  for (let i = 0; i < 1000; i++) total += costNano(500000, 0.02)
  assert.equal(nanoToNumber(total), 10)
  assert.equal(nanoToNumber(costNano(1, 0.02)), 0.00000002)
})

test('a frozen snapshot recomputes the same amount without the catalog', () => {
  const entry = deepseekEntry()
  const usage = usageOf({ inputTokens: 1000, cacheReadTokens: 5000, outputTokens: 200 })
  const result = priceCall({ entry, usage, at: BJ('2026-11-02T10:00:00+08:00'), mode: 'standard' })
  const snap = buildSnapshot({
    entry,
    tier: { id: result.tierId },
    windowId: result.windowId,
    prices: result.effectivePrices,
    result,
    requestModel: 'deepseek-flash',
    provider: 'deepseek-account',
    basis: 'official-id',
    mode: 'standard'
  })
  assert.equal(snap.prices.input, 2)
  assert.equal(snap.windowId, 'peak')
  assert.equal(snap.basis, 'official-id')
  // 目录/价格表怎么变，快照金额都不变
  const again = computeFromSnapshot(snap, usage)
  assert.equal(again.status, 'priced')
  assert.equal(again.amountCny, result.amountCny)
  // 用量为 0 的中断调用保留状态而不是金额
  const noUsage = computeFromSnapshot(snap, usageOf({}))
  assert.equal(noUsage.status, 'missing_usage')
  assert.equal(noUsage.amountCny, null)
})

test('a snapshot without an FX rate keeps the currency honest', () => {
  const snap = {
    v: 1,
    sourceId: 'x',
    officialModelId: 'usd-model',
    currency: 'USD',
    prices: { input: 1, cacheRead: null, cacheWrite: null, output: null },
    status: 'priced',
    missing: [],
    note: ''
  }
  const r = computeFromSnapshot(snap, usageOf({ inputTokens: 1000000 }))
  assert.equal(r.status, 'missing_fx')
  assert.equal(r.amountCny, null)
  assert.equal(r.amountOriginal, 1)
})
