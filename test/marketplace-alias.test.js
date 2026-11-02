import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAliasIndex, resolveModel } from '../lib/pricing/resolver.js'
import { normalizeCatalog } from '../lib/pricing/catalog.js'
import { createSourceAdapters } from '../lib/pricing/sources/index.js'

// 第三方市场已核验别名：scope 限定 command-code-goat（在哪家核验在哪家生效）。
// 依据 docs/source-verification/command-code-goat.zh-CN.md 与 deepseek.zh-CN.md。
// 纪律红线：未核验的市场 ID 维持"未计价"显形，绝不按前缀/相似度猜。

const seed = JSON.parse(readFileSync(new URL('../lib/pricing/seed-catalog.json', import.meta.url), 'utf8'))
const cat = normalizeCatalog(seed).catalog
const idx = buildAliasIndex(cat)

test('seed 目录携带三条已核验的 command-code-goat 市场别名', () => {
  const a = resolveModel('deepseek/deepseek-v4.1-flash', 'command-code-goat', cat, idx)
  assert.equal(a.status, 'matched')
  assert.equal(a.officialModelId, 'deepseek-flash')
  const b = resolveModel('deepseek-v4.1-flash', 'command-code-goat', cat, idx)
  assert.equal(b.status, 'matched')
  assert.equal(b.officialModelId, 'deepseek-flash')
  const c = resolveModel('xiaomi/mimo-v2.6-flash', 'command-code-goat', cat, idx)
  assert.equal(c.status, 'matched')
  assert.equal(c.officialModelId, 'mimo-v2.6-flash')
  const d = resolveModel('z-ai/glm-5.3-flash', 'command-code-goat', cat, idx)
  assert.equal(d.status, 'matched')
  assert.equal(d.officialModelId, 'glm-5.3-flash')
})

test('市场别名不外推到其他平台（scope 限定生效）', () => {
  for (const id of ['deepseek/deepseek-v4.1-flash', 'xiaomi/mimo-v2.6-flash', 'z-ai/glm-5.3-flash']) {
    const r = resolveModel(id, 'opencode-go', cat, idx)
    assert.equal(r.status, 'unknown_model', id)
  }
})

test('未核验的市场 ID 维持未计价，不猜', () => {
  for (const id of ['claude-haiku-5-5', 'meta/muse-spark-1.3-contributor', 'inclusionai/ling-3.1-flash-1019:free']) {
    const r = resolveModel(id, 'command-code-goat', cat, idx)
    assert.equal(r.status, 'unknown_model', id)
  }
})

test('parse 出口的市场别名恰好一条且带核验 scope（seed 生成与运行时刷新同路）', () => {
  const adapters = createSourceAdapters()
  const body = readFileSync(new URL('fixtures/pricing/deepseek.sample.json', import.meta.url), 'utf8')
  const parsed = adapters.deepseek.parse({ ok: true, body, contentType: 'application/json', statusCode: 200 })
  assert.equal(parsed.ok, true)
  const entry = parsed.block.models.find((m) => m.officialModelId === 'deepseek-flash')
  assert.ok(entry, 'deepseek-flash 条目存在')
  const hits = entry.aliases.filter((a) => a.id === 'deepseek/deepseek-v4.1-flash')
  assert.equal(hits.length, 1, '不重复登记')
  assert.deepEqual(hits[0].scope, ['command-code-goat'])
})

test('官方型号名大小写不敏感：实抓混合大小写条目同样挂上市场别名（GLM-5.3-Flash 回归）', () => {
  const adapters = createSourceAdapters()
  const raw = JSON.parse(readFileSync(new URL('fixtures/pricing/glm.sample.json', import.meta.url), 'utf8'))
  const entry = raw.models.find((m) => m.officialModelId === 'glm-5.3-flash')
  assert.ok(entry, 'fixture 含 glm-5.3-flash 条目')
  // 模拟实抓目录的形态：官方条目名是混合大小写 `GLM-5.3-Flash`（手核样本为小写）。
  entry.officialModelId = 'GLM-5.3-Flash'
  entry.aliases = ['glm-5.3-flash']
  const parsed = adapters.glm.parse({ ok: true, body: JSON.stringify(raw), contentType: 'application/json', statusCode: 200 })
  assert.equal(parsed.ok, true)
  const live = parsed.block.models.find((m) => m.officialModelId === 'GLM-5.3-Flash')
  assert.ok(live, '混合大小写条目保留')
  const hits = live.aliases.filter((a) => a.id === 'z-ai/glm-5.3-flash')
  assert.equal(hits.length, 1, '大小写不敏感挂载')
  assert.deepEqual(hits[0].scope, ['command-code-goat'])
})
