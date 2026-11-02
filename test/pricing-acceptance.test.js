import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveModel, buildAliasIndex } from '../lib/pricing/resolver.js'
import { priceCall, usageOf, buildSnapshot, computeFromSnapshot } from '../lib/pricing/engine.js'
import { validateSourceBlock, normalizeCatalog } from '../lib/pricing/catalog.js'

// 计划 §6 测试清单里三条容易被漏掉的验收点，单独放一个文件：
//   1) 同一确认模型由两个提供商调用必须落到同一官方规则；
//   2) 未来生效价与"生效时间未知"分别处理（不提前用、也不瞎猜区间）；
//   3) 价格目录变更不得改写已冻结快照的金额（刷新不重算历史的硬保证）。

function makeCatalog() {
  const block = {
    sourceId: 'acme',
    vendor: 'Acme',
    sourceUrl: 'https://acme.example/pricing',
    status: 'ok',
    fetchedAt: 1793500000000,
    models: [
      {
        sourceId: 'acme',
        officialModelId: 'acme-model-a',
        aliases: [{ id: 'model-a', scope: ['*'] }],
        currency: 'CNY',
        unit: 'per_1m_tokens',
        tiers: [{ id: 'default', prices: { input: 2, cacheRead: 0.4, cacheWrite: 2, output: 8 } }],
        cache: { readFallbackToInput: false, writeBilledAs: 'miss' },
        effective: { known: false, from: null, to: null },
        completeness: 'full',
        missing: []
      },
      {
        sourceId: 'acme',
        officialModelId: 'acme-future',
        aliases: [],
        currency: 'CNY',
        unit: 'per_1m_tokens',
        tiers: [{
          id: 'future',
          validFrom: 1800000000000,
          prices: { input: 10, cacheRead: 1, cacheWrite: 10, output: 20 }
        }],
        cache: { readFallbackToInput: false, writeBilledAs: 'miss' },
        effective: { known: true, from: 1800000000000, to: null },
        completeness: 'full',
        missing: []
      }
    ]
  }
  assert.equal(validateSourceBlock(block).ok, true)
  const r = normalizeCatalog({ sources: { acme: block } })
  assert.equal(r.ok, true, r.errors.join(';'))
  return r.catalog
}

// 1M 输入 + 0.5M 输出：2×1 + 8×0.5 = 6 元（acme-model-a）
const REC = {
  time: 1793500000000, model: 'model-a', provider: 'p',
  inputTokens: 1000000, outputTokens: 500000,
  cacheReadTokens: 0, cacheWriteTokens: 0
}
const USAGE = usageOf(REC)

test('the same confirmed model prices identically from two different providers', () => {
  const catalog = makeCatalog()
  const index = buildAliasIndex(catalog)
  const a = resolveModel('model-a', 'provider-one', catalog, index)
  const b = resolveModel('model-a', 'provider-two', catalog, index)
  const c = resolveModel('acme-model-a', 'provider-three', catalog, index)
  assert.equal(a.entry, b.entry)
  assert.equal(a.entry, c.entry)
  const amount = (entry) => priceCall({ entry, usage: USAGE, at: 1793500000000, mode: null }).amountCny
  assert.equal(amount(a.entry), 6)
  assert.equal(amount(b.entry), 6)
  assert.equal(amount(c.entry), 6)
})

test('a future-effective price is not used before it starts; unknown effective is always valid', () => {
  const catalog = makeCatalog()
  const future = catalog.sources.acme.models.find((m) => m.officialModelId === 'acme-future')
  // 生效时间之前：没有任何已核实区间覆盖该时刻 → 不计价（不提前用未来价）
  const before = priceCall({ entry: future, usage: USAGE, at: 1793500000000, mode: null })
  assert.equal(before.amountCny, null)
  assert.equal(before.status, 'missing_rule')
  // 生效之后：按新价计 10×1 + 20×0.5 = 20 元
  const after = priceCall({ entry: future, usage: USAGE, at: 1800000000001, mode: null })
  assert.equal(after.status, 'priced')
  assert.equal(after.amountCny, 20)

  // 生效时间未知（known:false）→ 不设区间门槛，任何时刻可计价
  const unknown = catalog.sources.acme.models.find((m) => m.officialModelId === 'acme-model-a')
  const early = priceCall({ entry: unknown, usage: USAGE, at: 1000, mode: null })
  assert.equal(early.status, 'priced')
  assert.equal(early.amountCny, 6)
})

test('a frozen snapshot keeps its amount after the catalog price changes', () => {
  const catalog = makeCatalog()
  const index = buildAliasIndex(catalog)
  const { entry } = resolveModel('model-a', 'p', catalog, index)
  const priced = priceCall({ entry, usage: USAGE, at: 1793500000000, mode: null })
  assert.equal(priced.status, 'priced')
  const snap = buildSnapshot({
    entry, tier: { id: priced.tierId }, windowId: priced.windowId,
    prices: priced.effectivePrices, result: priced,
    requestModel: 'model-a', provider: 'p', basis: 'official-id', mode: null
  })
  const before = computeFromSnapshot(snap, USAGE)
  assert.equal(before.status, 'priced')
  assert.equal(before.amountCny, 6)

  // 目录涨价 10 倍后，冻结快照的金额纹丝不动（目录刷新不改写历史）
  for (const t of entry.tiers) {
    for (const k of Object.keys(t.prices)) t.prices[k] = t.prices[k] * 10
  }
  const after = computeFromSnapshot(snap, USAGE)
  assert.equal(after.status, 'priced')
  assert.equal(after.amountCny, 6)
})
