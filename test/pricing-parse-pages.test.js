// 样张对拍：三家官方页面样张（test/fixtures/pricing/pages/）解析结果
// 必须与人工核验 fixture（test/fixtures/pricing/*.sample.json）的关键价一致。
// 语义红线：结构失配宁可 ok:false 保留上一次有效价格，绝不产伪精确金额。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SOURCE_DEFS } from '../lib/pricing/sources/index.js'
import { validateSourceBlock } from '../lib/pricing/catalog.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureOf = (id) => JSON.parse(readFileSync(path.join(here, 'fixtures', 'pricing', id + '.sample.json'), 'utf8'))
const pageOf = (name) => readFileSync(path.join(here, 'fixtures', 'pricing', 'pages', name), 'utf8')

const defOf = (id) => SOURCE_DEFS.find((d) => d.sourceId === id)
const payloadOf = (id) => ({ sourceId: id, sourceUrl: defOf(id).sourceUrl, vendor: id, fetchedAt: '2026-11-01T00:00:00.000Z' })
const parseOf = (id, body, pages) => defOf(id).parseText(body, payloadOf(id), { ok: true, body, url: defOf(id).fetchUrls[0], pages: pages || [] })
const rawPages = (pairs) => pairs.map(([url, name]) => ({ url, body: pageOf(name) }))

const byModel = (block, id) => block.models.find((m) => m.officialModelId.toLowerCase() === id.toLowerCase())
const tierOf = (entry, maxIn, maxOut) => (entry.tiers || []).find((t) =>
  t.mode !== 'batch' && (t.maxInputTokens ?? null) === (maxIn ?? null) && (t.maxOutputTokens ?? null) === (maxOut ?? null))
const numEq = (a, b) => assert.equal(a ?? null, b ?? null)

test('GLM 样张解析：39 型号逐档关键价与 fixture 一致', () => {
  const fx = fixtureOf('glm')
  const r = parseOf('glm', pageOf('glm-pricing.md'))
  assert.equal(r.ok, true, 'glm-pricing.md 应解析成功')
  const v = validateSourceBlock(r.block)
  assert.equal(v.ok, true, '解析块应通过目录校验：' + JSON.stringify(v.errors))
  assert.equal(r.block.models.length, fx.models.length, '型号数应与核验 fixture 一致')
  for (const fm of fx.models) {
    const entry = byModel(r.block, fm.officialModelId)
    assert.ok(entry, '缺少型号 ' + fm.officialModelId)
    if (fm.unsplitTokenRate != null) {
      assert.equal(entry.bucketSemantics, 'unsplit', fm.officialModelId + ' 应标 unsplit')
      assert.ok(entry.missing.includes('bucket_semantics'), fm.officialModelId + ' 应记 bucket_semantics 缺口')
      continue
    }
    for (const ft of (fm.tiers || [])) {
      const et = tierOf(entry, ft.maxInputTokens, ft.maxOutputTokens)
      assert.ok(et, fm.officialModelId + ' 缺档位 ' + ft.label)
      numEq(et.prices.input, ft.buckets.input)
      numEq(et.prices.output, ft.buckets.output)
      numEq(et.prices.cacheRead, ft.buckets.cachedInput)
    }
    if (Array.isArray(fm.inputModalities) && fm.inputModalities.length === 1 && fm.inputModalities[0] === 'audio') {
      assert.equal(entry.bucketSemantics, 'unsplit', fm.officialModelId + ' 单音频模态应标 unsplit')
    }
  }
})

test('GLM 样张解析：免费=0、不支持=null、联合分档边界（K=1000）', () => {
  const r = parseOf('glm', pageOf('glm-pricing.md'))
  const gl47 = byModel(r.block, 'GLM-4.7')
  // 输入 [0, 32K)，输出 [0, 0.2K) → 32000/200；输出 ≥0.2K → 32000/null；输入 [32K, 200K) → 200000/null
  assert.deepEqual(
    gl47.tiers.map((t) => [t.maxInputTokens, t.maxOutputTokens, t.prices.input, t.prices.output, t.prices.cacheRead]),
    [[32000, 200, 2, 8, 0.4], [32000, null, 3, 14, 0.6], [200000, null, 4, 16, 0.8]])
  // 官方明确免费 = 0（不是未知）；单档上下文「128K」是纯数字串 → tier 双 null（fixture 口径）
  const zf = byModel(r.block, 'GLM-Z1-Flash')
  const zt = tierOf(zf, null, null)
  assert.equal(zt.prices.input, 0)
  assert.equal(zt.prices.output, 0)
  // 缓存命中「不支持」= null（不是 0、不是免费）
  const ax = byModel(r.block, 'GLM-4-AirX')
  assert.equal(tierOf(ax, null, null).prices.cacheRead, null)
  // ASR 输出「不计费」= 0、命中不支持 = null
  const asr = byModel(r.block, 'GLM-ASR-2512')
  const at = tierOf(asr, null, null)
  assert.equal(at.prices.input, 16)
  assert.equal(at.prices.output, 0)
  assert.equal(at.prices.cacheRead, null)
})

test('Kimi 样张解析：6 型号含缓存写入 TTL 分档与批价，与 fixture 一致', () => {
  const fx = fixtureOf('kimi')
  const pairs = rawPages([
    ['https://platform.kimi.com/docs/pricing/chat', 'kimi-chat.html'],
    ['https://platform.kimi.com/docs/pricing/batch', 'kimi-batch.html']
  ])
  const r = parseOf('kimi', pairs[0].body, pairs)
  assert.equal(r.ok, true, 'kimi chat+batch 样张应解析成功')
  const v = validateSourceBlock(r.block)
  assert.equal(v.ok, true, '解析块应通过目录校验：' + JSON.stringify(v.errors))
  assert.equal(r.block.models.length, fx.models.length)
  for (const fm of fx.models) {
    const entry = byModel(r.block, fm.officialModelId)
    assert.ok(entry, '缺少型号 ' + fm.officialModelId)
    const std = entry.tiers.find((t) => t.mode !== 'batch')
    assert.equal(std.prices.input, fm.buckets.input, fm.officialModelId + ' 输入价')
    assert.equal(std.prices.output, fm.buckets.output, fm.officialModelId + ' 输出价')
    assert.equal(std.prices.cacheRead ?? null, fm.buckets.cachedInput ?? null, fm.officialModelId + ' 缓存命中价')
    if (fm.buckets.cacheWrite) {
      assert.deepEqual(std.prices.cacheWrite, fm.buckets.cacheWrite, fm.officialModelId + ' 缓存写入 TTL 分档')
      assert.equal(entry.cache.writeTtlDefault, 'ttl5m', fm.officialModelId + ' 默认 TTL 档')
    } else {
      assert.ok(!std.prices.cacheWrite, fm.officialModelId + ' 不支持缓存写入')
    }
    const batch = entry.tiers.find((t) => t.mode === 'batch')
    if (fm.batch && fm.batch.supported) {
      assert.ok(batch, fm.officialModelId + ' 应有 batch 档')
      assert.equal(batch.prices.input, fm.batch.input)
      assert.equal(batch.prices.output, fm.batch.output)
      assert.equal(batch.prices.cacheRead ?? null, fm.batch.cachedInput ?? null)
      assert.deepEqual(batch.prices.cacheWrite ?? null, fm.batch.cacheWrite ?? null)
    } else {
      assert.ok(!batch, fm.officialModelId + ' 不支持批量不应有 batch 档')
    }
  }
})

test('Qwen 样张解析：14 核心型号阶梯价/思考拆分/缓存与 fixture 一致', () => {
  const fx = fixtureOf('qwen')
  const pairs = rawPages([
    ['https://help.aliyun.com/zh/model-studio/model-pricing', 'qwen-pricing.html'],
    ['https://help.aliyun.com/zh/model-studio/context-cache', 'qwen-cache.html']
  ])
  const r = parseOf('qwen', pairs[0].body, pairs)
  assert.equal(r.ok, true, 'qwen 样张应解析成功')
  const v = validateSourceBlock(r.block)
  assert.equal(v.ok, true, '解析块应通过目录校验：' + JSON.stringify(v.errors))
  for (const fm of fx.models) {
    if (!fm.tiers || fm.tiers.length === 0) continue // qwen-turbo 来源不可用，页面无价行（不虚构，见下）
    const entry = byModel(r.block, fm.officialModelId)
    assert.ok(entry, '缺少型号 ' + fm.officialModelId)
    for (const ft of fm.tiers) {
      const et = tierOf(entry, ft.maxInputTokens, null)
      assert.ok(et, fm.officialModelId + ' 缺档位 maxInputTokens=' + ft.maxInputTokens)
      numEq(et.prices.input, ft.buckets.input)
      numEq(et.prices.output, ft.buckets.output)
      numEq(et.prices.cacheRead, ft.buckets.cachedInput)
      const thinking = (entry.tiers || []).find((t) => t.mode !== 'batch' && t.id === et.id.replace(/:standard$/, ':thinking'))
      if (fm.thinking && fm.thinking.separatelyPriced === true) {
        assert.ok(thinking, fm.officialModelId + ' 思考价应独立分档')
        numEq(thinking.prices.output, ft.thinkingOutput)
      } else {
        assert.ok(!thinking || thinking.id === et.id, fm.officialModelId + ' 不应拆思考档')
      }
    }
    // 缓存支持判定
    const fmCache = fm.cache || { supported: false }
    assert.equal(Boolean(entry.cache.readFallbackToInput), !fmCache.supported, fm.officialModelId + ' 缓存支持判定')
    if (fmCache.supported === false) {
      assert.equal(entry.cache.writeBilledAs, 'miss', fm.officialModelId + ' 命中按输入价')
    }
    for (const miss of (fm.missing || [])) {
      assert.ok(entry.missing.includes(miss), fm.officialModelId + ' 缺口清单应含 ' + miss + '，实际 ' + entry.missing.join(','))
    }
    // 别名：fixture ⊆ 解析（fixture 中与主 ID 仅大小写不同的写法不强求）
    const parsedAlias = new Set((entry.aliases || []).map((a) => a.id.toLowerCase()))
    for (const fa of (fm.aliases || [])) {
      const la = String(fa).toLowerCase()
      if (la === fm.officialModelId.toLowerCase()) continue
      assert.ok(parsedAlias.has(la), fm.officialModelId + ' 缺别名 ' + fa)
    }
  }
})

test('Qwen 样张解析：例外型号不猜缓存价、历史快照独立、turbo 不虚构', () => {
  const pairs = rawPages([
    ['https://help.aliyun.com/zh/model-studio/model-pricing', 'qwen-pricing.html'],
    ['https://help.aliyun.com/zh/model-studio/context-cache', 'qwen-cache.html']
  ])
  const r = parseOf('qwen', pairs[0].body, pairs)
  // 例外型号：命中价公开页无数值 → null + 缺口，不按 10% 推导
  const ex = byModel(r.block, 'qwen3.8-max')
  assert.ok(ex.missing.includes('cacheHitUnitPrice'))
  assert.equal(tierOf(ex, 1000000, null).prices.cacheRead, null)
  const fx2 = byModel(r.block, 'qwen3.8-flash')
  assert.ok(fx2.missing.includes('cacheWriteUnitPrice'))
  assert.ok(fx2.missing.includes('cacheHitUnitPrice'))
  // 例外清单以 fixture 为准核对
  for (const id of ['qwen3.8-max', 'qwen3.8-2.4t-a95b']) {
    assert.ok(byModel(r.block, id).missing.includes('cacheHitUnitPrice'), id + ' 例外应记缺口')
  }
  // 未标 Batch 的型号不得带 batch 档
  assert.ok(!byModel(r.block, 'qwen3.6-27b').tiers.some((t) => t.mode === 'batch'))
  // qwen-turbo 价格页无文本模型价行 → 不得虚构条目或单价
  assert.equal(byModel(r.block, 'qwen-turbo'), undefined, 'qwen-turbo 不应被虚构')
  // 历史快照行（阶梯与主型号不同价）保持独立条目，不并入别名
  const hist = byModel(r.block, 'qwen-plus-2025-07-14')
  assert.ok(hist, '历史快照行应独立保留')
})

test('结构失配：三家样张被替换为无关内容时 ok:false（保留上一次有效价格）', () => {
  const garbage = '<html><body><h1>已改版</h1></body></html>'
  for (const id of ['glm', 'kimi', 'qwen']) {
    const r = parseOf(id, garbage, id === 'qwen'
      ? rawPages([['https://help.aliyun.com/zh/model-studio/model-pricing', 'qwen-pricing.html']])
      : [])
    assert.equal(r.ok, false, id + ' 结构失配应 ok:false')
    assert.ok(String(r.error || (r.errors || []).join(';')).length > 0, id + ' 应给出失配原因')
  }
  // Qwen 缺少 context-cache 页 → 无法确定缓存支持范围，拒绝解析
  const pairs = rawPages([['https://help.aliyun.com/zh/model-studio/model-pricing', 'qwen-pricing.html']])
  const r2 = parseOf('qwen', pairs[0].body, pairs)
  assert.equal(r2.ok, false)
  assert.ok(String(r2.error).includes('保留上一次有效价格'))
  // Kimi chat 页无行（换成 batch 页单独喂）→ 失配
  const r3 = parseOf('kimi', pageOf('kimi-batch.html'), [])
  assert.equal(r3.ok, false)
})
