import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAliasIndex, resolveModel } from '../lib/pricing/resolver.js'
import { normalizeCatalog } from '../lib/pricing/catalog.js'
import { createSourceAdapters, applyMarketplaceAliases } from '../lib/pricing/sources/index.js'

// 第三方市场已核验别名：scope 限定 command-code-goat（在哪家核验在哪家生效）。
// 依据 docs/source-verification/command-code-goat.zh-CN.md 与 deepseek.zh-CN.md。
// 纪律红线：未核验的市场 ID 维持"未计价"显形，绝不按前缀/相似度猜。

const seed = JSON.parse(readFileSync(new URL('../lib/pricing/seed-catalog.json', import.meta.url), 'utf8'))
const cat = normalizeCatalog(seed).catalog
const idx = buildAliasIndex(cat)

test('seed 目录携带 GOAT 五家已核验市场别名（27 条映射），解析结果带官方条目', () => {
  for (const [id, official] of [
    ['deepseek/deepseek-v4.1-flash', 'deepseek-flash'],
    ['deepseek-v4.1-flash', 'deepseek-flash'],
    ['deepseek/deepseek-v4-flash', 'deepseek-flash'],
    ['deepseek/deepseek-v4-flash-vision-exp', 'deepseek-flash'],
    ['deepseek/deepseek-v4-pro', 'deepseek-v4-pro'],
    ['xiaomi/mimo-v2.6-flash', 'mimo-v2.6-flash'],
    ['xiaomi/mimo-v2.6-pro', 'mimo-v2.6-pro'],
    ['xiaomi/mimo-v2.6-pro-ultraspeed', 'mimo-v2.6-pro-ultraspeed'],
    ['Qwen/Qwen3.8-Max', 'qwen3.8-max'],
    ['Qwen/Qwen3.8-Max-0902', 'qwen3.8-max'],
    ['Qwen/Qwen3.8-27B', 'qwen3.8-27b'],
    ['Qwen/Qwen3.8-Flash', 'qwen3.8-flash'],
    ['Qwen/Qwen3.7-Max', 'qwen3.7-max'],
    ['Qwen/Qwen3.7-Plus', 'qwen3.7-plus'],
    ['Qwen/Qwen3.7-Flash', 'qwen3.7-flash'],
    ['Qwen/Qwen3.6-Plus', 'qwen3.6-plus'],
    ['moonshotai/Kimi-K3.1-Pro', 'kimi-k3.1-pro'],
    ['moonshotai/Kimi-K3', 'kimi-k3'],
    ['moonshotai/Kimi-K2.7-Code', 'kimi-k2.7-code'],
    ['moonshotai/Kimi-K2.7-Code-Highspeed', 'kimi-k2.7-code-highspeed'],
    ['moonshotai/Kimi-K2.6', 'kimi-k2.6'],
    ['z-ai/glm-5.3-flash', 'glm-5.3-flash'],
    ['z-ai/glm-5.3-flashx', 'glm-5.3-flashx'],
    ['zai-org/GLM-5.3', 'glm-5.3'],
    ['zai-org/GLM-5.2', 'glm-5.2'],
    ['zai-org/GLM-5.1', 'GLM-5.1'],
    ['zai-org/GLM-5', 'GLM-5']
  ]) {
    const r = resolveModel(id, 'command-code-goat', cat, idx)
    assert.equal(r.status, 'matched', `${id} 应解析到官方型号`)
    assert.equal(r.officialModelId, official)
    assert.ok(r.entry, `${id} 应对应目录里的官方条目`)
  }
})

test('市场别名不外推到其他平台（scope 限定生效）', () => {
  for (const id of [
    'deepseek/deepseek-v4.1-flash',
    'xiaomi/mimo-v2.6-flash',
    'z-ai/glm-5.3-flash',
    'deepseek/deepseek-v4-pro',
    'xiaomi/mimo-v2.6-pro',
    'Qwen/Qwen3.8-Max',
    'moonshotai/Kimi-K3',
    'zai-org/GLM-5.3'
  ]) {
    const r = resolveModel(id, 'opencode-go', cat, idx)
    assert.equal(r.status, 'unknown_model', id)
  }
})

test('未核验的市场 ID 维持未计价，不猜', () => {
  for (const id of [
    'claude-haiku-5-5',
    'meta/muse-spark-1.3-contributor',
    'inclusionai/ling-3.1-flash-1019:free',
    'deepseek/deepseek-v4-flash-fast',
    'deepseek/deepseek-v4.1-flash-fast',
    'Qwen/Qwen3.8-Omni-Flash',
    'Qwen/Qwen3.8-Max-Prime',
    'Qwen/Qwen3.6-Max-Preview',
    'moonshotai/Kimi-K2.5',
    'zai-org/GLM-5.2-Fast'
  ]) {
    const r = resolveModel(id, 'command-code-goat', cat, idx)
    assert.equal(r.status, 'unknown_model', id)
  }
})

test('parse 出口的市场别名恰好覆盖登记集且带核验 scope（seed 生成与运行时刷新同路）', () => {
  const adapters = createSourceAdapters()
  const body = readFileSync(new URL('fixtures/pricing/deepseek.sample.json', import.meta.url), 'utf8')
  const parsed = adapters.deepseek.parse({ ok: true, body, contentType: 'application/json', statusCode: 200 })
  assert.equal(parsed.ok, true)
  const entry = parsed.block.models.find((m) => m.officialModelId === 'deepseek-flash')
  const hits = entry.aliases.filter((a) => a.id === 'deepseek/deepseek-v4.1-flash')
  assert.equal(hits.length, 1, '不重复登记')
  assert.deepEqual(hits[0].scope, ['command-code-goat'])
  // deepseek-flash 条目的 GOAT 专属别名恰好是登记集（裸名 scope * 别名不在此列）。
  const goatScoped = entry.aliases
    .filter((a) => a.scope[0] === 'command-code-goat')
    .map((a) => a.id)
    .sort()
  assert.deepEqual(goatScoped, [
    'deepseek-v4.1-flash',
    'deepseek/deepseek-v4-flash',
    'deepseek/deepseek-v4-flash-vision-exp',
    'deepseek/deepseek-v4.1-flash'
  ])
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

test('GOAT 五家前缀形态别名全量挂载（23 个，scope 限定 command-code-goat）', () => {
  const cases = [
    ['deepseek', 'deepseek-flash', 'deepseek/deepseek-v4-flash'],
    ['deepseek', 'deepseek-flash', 'deepseek/deepseek-v4-flash-vision-exp'],
    ['deepseek', 'deepseek-v4-pro', 'deepseek/deepseek-v4-pro'],
    ['mimo', 'mimo-v2.6-pro', 'xiaomi/mimo-v2.6-pro'],
    ['mimo', 'mimo-v2.6-pro-ultraspeed', 'xiaomi/mimo-v2.6-pro-ultraspeed'],
    ['qwen', 'qwen3.8-max', 'Qwen/Qwen3.8-Max'],
    ['qwen', 'qwen3.8-max', 'Qwen/Qwen3.8-Max-0902'],
    ['qwen', 'qwen3.8-27b', 'Qwen/Qwen3.8-27B'],
    ['qwen', 'qwen3.8-flash', 'Qwen/Qwen3.8-Flash'],
    ['qwen', 'qwen3.7-max', 'Qwen/Qwen3.7-Max'],
    ['qwen', 'qwen3.7-plus', 'Qwen/Qwen3.7-Plus'],
    ['qwen', 'qwen3.7-flash', 'Qwen/Qwen3.7-Flash'],
    ['qwen', 'qwen3.6-plus', 'Qwen/Qwen3.6-Plus'],
    ['kimi', 'kimi-k3.1-pro', 'moonshotai/Kimi-K3.1-Pro'],
    ['kimi', 'kimi-k3', 'moonshotai/Kimi-K3'],
    ['kimi', 'kimi-k2.7-code', 'moonshotai/Kimi-K2.7-Code'],
    ['kimi', 'kimi-k2.7-code-highspeed', 'moonshotai/Kimi-K2.7-Code-Highspeed'],
    ['kimi', 'kimi-k2.6', 'moonshotai/Kimi-K2.6'],
    // 实抓 GLM 目录是混合大小写官方名，此处一并验证大小写不敏感挂载。
    ['glm', 'GLM-5.3-FlashX', 'z-ai/glm-5.3-flashx'],
    ['glm', 'GLM-5.3', 'zai-org/GLM-5.3'],
    ['glm', 'GLM-5.2', 'zai-org/GLM-5.2'],
    ['glm', 'GLM-5.1', 'zai-org/GLM-5.1'],
    ['glm', 'GLM-5', 'zai-org/GLM-5']
  ]
  assert.equal(cases.length, 23, '新登记别名计数')
  for (const [sourceId, officialModelId, aliasId] of cases) {
    const result = applyMarketplaceAliases(
      { ok: true, block: { models: [{ officialModelId, aliases: [] }] } },
      sourceId
    )
    const model = result.block.models[0]
    const hits = (model.aliases || []).filter((a) => a.id === aliasId)
    assert.equal(hits.length, 1, `${sourceId} ${officialModelId} 应挂上 ${aliasId}`)
    assert.deepEqual(hits[0].scope, ['command-code-goat'])
  }
})
