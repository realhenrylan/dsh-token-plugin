import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateModelEntry,
  validateSourceBlock,
  normalizeCatalog,
  catalogFingerprint,
  emptyCatalog,
  CATALOG_VERSION
} from '../lib/pricing/catalog.js'

// 第一阶段硬约束：目录条目必须自带完整性标注；价格缺失要显式写 null，
// 不能悄悄补 0（那会把"未知"变成"免费"）。

const baseEntry = () => ({
  sourceId: 'deepseek',
  sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  officialModelId: 'deepseek-flash',
  aliases: [{ id: 'deepseek-v4-flash', scope: ['*'] }],
  currency: 'CNY',
  unit: 'per_1m_tokens',
  cache: { readFallbackToInput: false, writeBilledAs: 'miss' },
  tiers: [{ id: 'standard', prices: { input: 1, cacheRead: 0.02, cacheWrite: null, output: 4 } }],
  effective: { known: true, from: Date.parse('2026-09-10T12:00:00+08:00'), to: null },
  fetchedAt: Date.now(),
  completeness: 'full',
  missing: []
})

test('a complete entry validates', () => {
  const r = validateModelEntry(baseEntry())
  assert.deepEqual(r.errors, [])
  assert.equal(r.ok, true)
})

test('price rows accept explicit null (not covered) and reject garbage numbers', () => {
  const ok = baseEntry()
  ok.tiers[0].prices.cacheWrite = null
  assert.equal(validateModelEntry(ok).ok, true)
  const bad = baseEntry()
  bad.tiers[0].prices.input = -1
  assert.equal(validateModelEntry(bad).ok, false)
  const nan = baseEntry()
  nan.tiers[0].prices.output = Number.NaN
  assert.equal(validateModelEntry(nan).ok, false)
})

test('TTL-tiered prices (Kimi cache write) are accepted as objects of numbers', () => {
  const e = baseEntry()
  e.tiers[0].prices.cacheWrite = { ttl5m: 13, ttl1h: 26 }
  assert.equal(validateModelEntry(e).ok, true)
  e.tiers[0].prices.cacheWrite = { ttl5m: 'x' }
  assert.equal(validateModelEntry(e).ok, false)
})

test('partial completeness must list what is missing', () => {
  const e = baseEntry()
  e.completeness = 'partial'
  assert.equal(validateModelEntry(e).ok, false)
  e.missing = ['effective_date']
  assert.equal(validateModelEntry(e).ok, true)
})

test('an unknown effective date must not carry a fabricated effective time', () => {
  const e = baseEntry()
  e.effective = { known: false, from: Date.now(), to: null }
  assert.equal(validateModelEntry(e).ok, false)
  e.effective = { known: false, from: null, to: null }
  assert.equal(validateModelEntry(e).ok, true)
})

test('aliases need an explicit platform scope', () => {
  const e = baseEntry()
  e.aliases = [{ id: 'x' }]
  assert.equal(validateModelEntry(e).ok, false)
  e.aliases = [{ id: 'x', scope: ['siliconflow'] }]
  assert.equal(validateModelEntry(e).ok, true)
})

test('an unavailable source may carry zero models, an ok source may not', () => {
  const block = (status, models) => ({
    sourceId: 'kimi',
    sourceUrl: 'https://platform.kimi.com/docs/pricing/chat',
    status,
    models
  })
  assert.equal(validateSourceBlock(block('never', [])).ok, true)
  assert.equal(validateSourceBlock(block('ok', [])).ok, false)
  assert.equal(validateSourceBlock(block('ok', [baseEntry()])).ok, false, 'entry sourceId must match the block')
  const entry = { ...baseEntry(), sourceId: 'kimi' }
  assert.equal(validateSourceBlock(block('ok', [entry])).ok, true)
})

test('normalizeCatalog rejects a whole catalog with one bad source (keep last good data)', () => {
  const good = {
    sources: {
      deepseek: {
        sourceId: 'deepseek',
        sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
        status: 'ok',
        models: [baseEntry()]
      }
    }
  }
  assert.equal(normalizeCatalog(good).ok, true)
  const bad = {
    sources: {
      deepseek: good.sources.deepseek,
      mimo: {
        sourceId: 'mimo',
        sourceUrl: 'https://mimo.mi.com/docs/pricing',
        status: 'ok',
        models: [{ officialModelId: 'mimo-v2.6-flash', currency: 'CNY', unit: 'per_1m_tokens', tiers: [{ prices: { input: 'x' } }], effective: { known: false, from: null, to: null }, fetchedAt: 1, completeness: 'partial', missing: ['a'] }]
      }
    }
  }
  const r = normalizeCatalog(bad)
  assert.equal(r.ok, false)
  assert.equal(r.catalog, null)
  assert.ok(r.errors.some((e) => e.indexOf('mimo') >= 0))
})

test('catalog fingerprint changes only when price content changes', () => {
  const c1 = normalizeCatalog({
    sources: { deepseek: { sourceId: 'deepseek', sourceUrl: 'https://x/y', status: 'ok', models: [baseEntry()] } }
  }).catalog
  const c2 = normalizeCatalog({
    sources: { deepseek: { sourceId: 'deepseek', sourceUrl: 'https://x/y', status: 'ok', models: [baseEntry()] } }
  }).catalog
  assert.equal(catalogFingerprint(c1), catalogFingerprint(c2))
  const changed = baseEntry()
  changed.tiers[0].prices.output = 5
  const c3 = normalizeCatalog({
    sources: { deepseek: { sourceId: 'deepseek', sourceUrl: 'https://x/y', status: 'ok', models: [changed] } }
  }).catalog
  assert.notEqual(catalogFingerprint(c1), catalogFingerprint(c3))
})

test('emptyCatalog marks every source as never', () => {
  const c = emptyCatalog([{ sourceId: 'glm', sourceUrl: 'https://docs.bigmodel.cn/cn/guide/start/pricing', vendor: '智谱 GLM' }])
  assert.equal(c.catalogVersion, CATALOG_VERSION)
  assert.equal(c.sources.glm.status, 'never')
  assert.deepEqual(c.sources.glm.models, [])
})
