import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAliasIndex, resolveModel } from '../lib/pricing/resolver.js'
import { normalizeCatalog } from '../lib/pricing/catalog.js'

// 第一阶段硬约束：只做显式、可追溯的映射；不做前缀裁剪、不做模糊匹配；
// 第三方同名模型不自动套用开发方官方价。

function catalogWith(entries) {
  return normalizeCatalog({
    sources: {
      deepseek: {
        sourceId: 'deepseek',
        sourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
        status: 'ok',
        models: entries.map((e) => ({
          sourceId: 'deepseek',
          officialModelId: e.id,
          aliases: e.aliases || [],
          currency: 'CNY',
          unit: 'per_1m_tokens',
          tiers: [{ id: 'standard', prices: { input: 1, cacheRead: 0.02, output: 4 } }],
          effective: { known: true, from: 1, to: null },
          fetchedAt: 1,
          completeness: 'full',
          missing: []
        }))
      }
    }
  }).catalog
}

const cat = catalogWith([
  { id: 'deepseek-flash', aliases: [{ id: 'deepseek-v4-flash', scope: ['*'] }, { id: 'deepseek-v4-flash-vision-exp', scope: ['*'] }] },
  { id: 'deepseek-v4-pro' },
  { id: 'qwen3.6-27b', aliases: [{ id: 'qwen/qwen3.6-27b', scope: ['siliconflow'] }] }
])
const idx = buildAliasIndex(cat)

test('an official model id resolves regardless of case and platform', () => {
  const r = resolveModel('DeepSeek-Flash', 'deepseek-account', cat, idx)
  assert.equal(r.status, 'matched')
  assert.equal(r.officialModelId, 'deepseek-flash')
  assert.equal(r.basis, 'official-id')
})

test('verified aliases resolve on any platform when scoped *', () => {
  const r = resolveModel('deepseek-v4-flash-vision-exp', 'deepseek', cat, idx)
  assert.equal(r.status, 'matched')
  assert.equal(r.officialModelId, 'deepseek-flash')
  assert.equal(r.basis, 'alias:deepseek-v4-flash-vision-exp')
})

test('a platform-scoped alias only applies on that platform', () => {
  const onSf = resolveModel('qwen/qwen3.6-27b', 'siliconflow', cat, idx)
  assert.equal(onSf.status, 'matched')
  assert.equal(onSf.officialModelId, 'qwen3.6-27b')
  const elsewhere = resolveModel('qwen/qwen3.6-27b', 'openrouter', cat, idx)
  assert.equal(elsewhere.status, 'unknown_model')
  assert.ok(elsewhere.note.indexOf('平台范围') >= 0)
})

test('similar names are never matched by prefix or substring', () => {
  for (const name of ['deepseek', 'flash', 'pro', 'deepseek-flash-old', 'my-deepseek-flash', 'DeepSeek V4 Pro', 'kimi-k3', 'mimo-v2.6-flash', '']) {
    const r = resolveModel(name, 'deepseek', cat, idx)
    assert.equal(r.status, 'unknown_model', name)
  }
})

test('two official models hitting the same alias is ambiguous, not guessed', () => {
  const c2 = catalogWith([
    { id: 'model-a', aliases: [{ id: 'shared', scope: ['*'] }] },
    { id: 'model-b', aliases: [{ id: 'shared', scope: ['*'] }] }
  ])
  const r = resolveModel('shared', 'x', c2, buildAliasIndex(c2))
  assert.equal(r.status, 'ambiguous')
  assert.equal(r.entry, null)
  assert.ok(r.note.indexOf('不做猜测计价') >= 0)
})

test('resolution carries the entry used for pricing', () => {
  const r = resolveModel('deepseek-v4-pro', 'deepseek-official', cat, idx)
  assert.equal(r.status, 'matched')
  assert.equal(r.entry.officialModelId, 'deepseek-v4-pro')
})

test('the index is reusable and cache-friendly', () => {
  const a = buildAliasIndex(cat)
  const b = buildAliasIndex(cat)
  assert.deepEqual(Array.from(a.keys()).sort(), Array.from(b.keys()).sort())
})
