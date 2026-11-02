import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSourceAdapter, SOURCE_DEFS } from '../lib/pricing/sources/index.js'
import { checkSourceUrl, fetchSource, SOURCE_LIMITS } from '../lib/pricing/sources/common.js'
import { validateSourceBlock } from '../lib/pricing/catalog.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureOf = (id) => JSON.parse(readFileSync(path.join(here, 'fixtures', 'pricing', id + '.sample.json'), 'utf8'))
const adapterOf = (id) => createSourceAdapter(SOURCE_DEFS.find((d) => d.sourceId === id))

const parseFixture = (id) => adapterOf(id).parse({ ok: true, body: JSON.stringify(fixtureOf(id)), contentType: 'application/json', statusCode: 200 })

// 第一阶段来源核验样本 → 目录条目：五个来源都必须能从脱敏样本重建价格，
// 且重建结果通过目录校验（结构异常 = 拒绝，不允许半截条目）。

for (const id of ['deepseek', 'mimo', 'qwen', 'kimi', 'glm']) {
  test(id + ' sample parses into a valid source block', () => {
    const r = parseFixture(id)
    assert.equal(r.ok, true, r.error || '')
    const check = validateSourceBlock(r.block)
    assert.equal(check.ok, true, check.errors.join('；'))
    assert.equal(r.block.sourceId, id)
    assert.ok(r.block.models.length > 0)
  })
}

test('DeepSeek sample keeps verified aliases and the peak/valley windows', () => {
  const block = parseFixture('deepseek').block
  const flash = block.models.find((m) => m.officialModelId === 'deepseek-flash')
  assert.ok(flash.aliases.some((a) => a.id === 'deepseek-v4-flash'))
  const win = Object.fromEntries(flash.tiers[0].windows.map((w) => [w.id, w.prices]))
  assert.equal(win.offPeak.output, 4)
  assert.equal(win.peak.output, 8)
  assert.equal(flash.tiers[0].verified, undefined, '现行价段默认视为已核验')
  // 历史价段带未复核标记
  const hist = flash.tiers.filter((t) => t.verified === false)
  assert.equal(hist.length, 2)
  assert.ok(flash.periods.peakWindows.length === 2)
})

test('MiMo sample separates the three V2.6 models and keeps batch prices', () => {
  const block = parseFixture('mimo').block
  const ultra = block.models.find((m) => m.officialModelId === 'mimo-v2.6-pro-ultraspeed')
  assert.equal(ultra.tiers[0].prices.input, 30)
  assert.equal(ultra.tiers.find((t) => t.mode === 'batch'), undefined, 'ultraspeed 不支持 Batch')
  const pro = block.models.find((m) => m.officialModelId === 'mimo-v2.6-pro')
  assert.equal(pro.tiers.find((t) => t.mode === 'batch').prices.input, 1.5)
  // 缓存写入限时免费 → 显式 0 价
  assert.equal(pro.tiers[0].prices.cacheWrite, 0)
})

test('Qwen sample keeps length tiers, thinking split and honest gaps', () => {
  const block = parseFixture('qwen').block
  const q27 = block.models.find((m) => m.officialModelId === 'qwen3.6-27b')
  assert.equal(q27.tiers[0].prices.input, 3)
  assert.equal(q27.tiers[0].maxInputTokens, 256000)
  // 不在官方缓存支持列表 → 缓存命中按输入价计（不算缺价）
  assert.equal(q27.cache.readFallbackToInput, true)
  const plus = block.models.find((m) => m.officialModelId === 'qwen-plus')
  assert.ok(plus.tiers.some((t) => t.mode === 'thinking'))
  assert.ok(plus.tiers.some((t) => t.mode === 'standard'))
  const turbo = block.models.find((m) => m.officialModelId === 'qwen-turbo')
  assert.equal(turbo.completeness, 'partial')
  assert.ok(turbo.missing.length > 0, '无官方价格的型号必须带缺口标注')
})

test('Kimi sample carries TTL-tiered cache write with the documented default', () => {
  const block = parseFixture('kimi').block
  const k3 = block.models.find((m) => m.officialModelId === 'kimi-k3')
  assert.equal(k3.tiers[0].prices.cacheWrite.ttl5m, 20)
  assert.equal(k3.tiers[0].prices.cacheWrite.ttl1h, 40)
  assert.equal(k3.cache.writeTtlDefault, 'ttl5m')
  assert.equal(k3.tiers.find((t) => t.mode === 'batch').prices.input, 12)
})

test('GLM sample keeps joint tiers, unsplit-token models and non-token items out of the token formula', () => {
  const block = parseFixture('glm').block
  const glm47 = block.models.find((m) => m.officialModelId === 'glm-4.7')
  assert.equal(glm47.tiers.length, 3)
  assert.equal(glm47.tiers[0].maxOutputTokens, 200)
  const voice = block.models.find((m) => m.officialModelId === 'GLM-4-Voice')
  assert.equal(voice.bucketSemantics, 'unsplit', '未分桶单价不得套文本公式')
  const asr = block.models.find((m) => m.officialModelId === 'GLM-ASR-2512')
  assert.equal(asr.bucketSemantics, 'unsplit')
})

// ── 文本解析（仅对结构已实测的来源启用） ─────────────────────────────────

test('MiMo markdown price table parses model rows and batch rows', () => {
  const md = [
    '**Language Models**',
    '<table><tr><th>Inference Type</th><th>Model Name</th><th>Input (Cache Hit)</th><th>Input (Cache Miss)</th><th>Output</th></tr>',
    '<tr><td>Real-time API</td><td>`mimo-v2.6-pro`</td><td>¥0.025</td><td>¥3.00</td><td>¥6.00</td></tr>',
    '<tr><td></td><td>`mimo-v2.6-flash`</td><td>¥0.02</td><td>¥1.00</td><td>¥2.00</td></tr>',
    '<tr><td>Batch API</td><td>`mimo-v2.6-pro`</td><td>¥0.0125</td><td>¥1.50</td><td>¥3.00</td></tr>',
    '</table>'
  ].join('\n')
  const r = adapterOf('mimo').parse({ ok: true, body: md, contentType: 'text/markdown', statusCode: 200 })
  assert.equal(r.ok, true, r.error || '')
  const pro = r.block.models.find((m) => m.officialModelId === 'mimo-v2.6-pro')
  assert.equal(pro.tiers[0].prices.input, 3)
  assert.equal(pro.tiers.find((t) => t.mode === 'batch').prices.input, 1.5)
})

test('MiMo USD tables never become CNY batch prices', () => {
  const md = [
    '<table><tr><th>Inference Type</th><th>Model Name</th><th>Input (Cache Hit)</th><th>Input (Cache Miss)</th><th>Output</th></tr>',
    '<tr><td>Real-time API</td><td>`mimo-v2.6-pro`</td><td>¥0.025</td><td>¥3.00</td><td>¥6.00</td></tr>',
    '<tr><td>Batch API</td><td>`mimo-v2.6-pro`</td><td>¥0.0125</td><td>¥1.50</td><td>¥3.00</td></tr>',
    '<tr><td>Real-time API</td><td>`mimo-v2.6-pro`</td><td>$0.0036</td><td>$0.435</td><td>$0.87</td></tr>',
    '<tr><td>Batch API</td><td>`mimo-v2.6-pro`</td><td>$0.0018</td><td>$0.2175</td><td>$0.435</td></tr>',
    '</table>'
  ].join('\n')
  const r = adapterOf('mimo').parse({ ok: true, body: md, contentType: 'text/markdown', statusCode: 200 })
  assert.equal(r.ok, true, r.error || '')
  const pro = r.block.models.find((m) => m.officialModelId === 'mimo-v2.6-pro')
  assert.equal(pro.currency, 'CNY')
  assert.equal(pro.tiers[0].prices.input, 3)
  assert.equal(pro.tiers.find((t) => t.mode === 'batch').prices.input, 1.5)
})

test('DeepSeek markdown price table parses the six labelled price rows', () => {
  const md = [
    '| 模型 | 模型 | 模型 | deepseek-flash(1) | deepseek-v4-pro |',
    '| --- | --- | --- | --- | --- |',
    '| 价格(2) | 百万tokens输入 / （缓存命中） | 空闲时段 | 0.02元 | 0.15元 |',
    '| 价格(2) | 百万tokens输入 / （缓存命中） | 高峰时段 | 0.04元 | 0.30元 |',
    '| 价格(2) | 百万tokens输入 / （缓存未命中） | 空闲时段 | 1元 | 4.5元 |',
    '| 价格(2) | 百万tokens输入 / （缓存未命中） | 高峰时段 | 2元 | 9.0元 |',
    '| 价格(2) | 百万tokens输出 | 空闲时段 | 4元 | 13.5元 |',
    '| 价格(2) | 百万tokens输出 | 高峰时段 | 8元 | 27.0元 |'
  ].join('\n')
  const r = adapterOf('deepseek').parse({ ok: true, body: md, contentType: 'text/markdown', statusCode: 200 })
  assert.equal(r.ok, true, r.error || '')
  const flash = r.block.models.find((m) => m.officialModelId === 'deepseek-flash')
  const win = Object.fromEntries(flash.tiers[0].windows.map((w) => [w.id, w.prices]))
  assert.equal(win.offPeak.output, 4)
  assert.equal(win.peak.output, 8)
  assert.equal(win.offPeak.cacheRead, 0.02)
})

test('a structurally broken page is rejected (keep last good cache), never guessed', () => {
  const r = adapterOf('deepseek').parse({ ok: true, body: '价格表暂时不可用 | 0.02元', contentType: 'text/html', statusCode: 200 })
  assert.equal(r.ok, false)
  assert.ok(r.error.indexOf('保留上一次有效价格') >= 0)
})

test('sources without a verified parse channel report unusable instead of faking prices', () => {
  for (const id of ['qwen', 'kimi', 'glm']) {
    const r = adapterOf(id).parse({ ok: true, body: '<html>动态渲染页面</html>', contentType: 'text/html', statusCode: 200 })
    assert.equal(r.ok, false, id)
    assert.ok(r.error.indexOf('保留上一次有效价格') >= 0, id + ': ' + r.error)
  }
})

// ── 抓取约束 ─────────────────────────────────────────────────────────────

test('only preset official HTTPS hosts are fetchable', () => {
  assert.equal(checkSourceUrl('https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md', ['api-docs.deepseek.com']).ok, true)
  assert.equal(checkSourceUrl('https://evil.example.com/x', ['api-docs.deepseek.com']).ok, false)
  assert.equal(checkSourceUrl('https://api-docs.deepseek.com.evil.example.com/x', ['api-docs.deepseek.com']).ok, false)
  assert.equal(checkSourceUrl('http://api-docs.deepseek.com/x', ['api-docs.deepseek.com']).ok, false, '只允许 HTTPS')
  assert.equal(checkSourceUrl('https://user:pass@api-docs.deepseek.com/x', ['api-docs.deepseek.com']).ok, false, 'URL 不得携带凭据')
})

test('oversized responses are refused before parsing', async () => {
  const fetcher = { get: async () => ({ ok: true, statusCode: 200, contentType: 'text/html', body: 'x'.repeat(SOURCE_LIMITS.maxBytes + 1) }) }
  const r = await fetchSource(fetcher, { url: 'https://mimo.mi.com/static/docs/price/pay-as-you-go.md', hosts: ['mimo.mi.com'] })
  assert.equal(r.ok, false)
  assert.ok(r.error.indexOf('上限') >= 0)
})

test('non-200 responses are failures', async () => {
  const fetcher = { get: async () => ({ ok: true, statusCode: 503, contentType: 'text/html', body: '' }) }
  const r = await fetchSource(fetcher, { url: 'https://mimo.mi.com/x', hosts: ['mimo.mi.com'] })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'HTTP 503')
})
