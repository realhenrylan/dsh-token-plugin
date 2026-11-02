import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  isDeepseekProvider,
  modelKeyOf
} from '../lib/index.js'
import { buildAliasIndex, resolveModel } from '../lib/pricing/resolver.js'
import { normalizeCatalog } from '../lib/pricing/catalog.js'
import { priceCall, usageOf } from '../lib/pricing/engine.js'

// 回归用例来自 issue #19：DeepSeek Harness Desktop 0.2.1 里，官方账号那一路的
// provider id 是 `deepseek-account`。旧实现用 `deepseek-official` / `deepseek`
// 两个字面量做白名单，于是这类记录的费用恒为 ¥0，也从不写冻结快照。
// 现在计费只认「模型开发方官方价」，与调用经过哪个平台无关：
// 只要模型能可靠映射到 DeepSeek 官方条目，就按 DeepSeek 官方价计算。

test('any deepseek-* provider id bills with the DeepSeek official price table', () => {
  for (const id of ['deepseek', 'deepseek-official', 'deepseek-account', 'deepseek-api-key', ' DeepSeek-Account ']) {
    assert.equal(isDeepseekProvider(id), true, String(id))
  }
})

test('third-party and internal provider ids stay outside the DeepSeek table', () => {
  const ids = [
    'siliconflow', 'digital-ocean', 'digitalocean', 'amd', 'amd-gpu-cloud',
    'alibaba', 'aliyun', 'qwen', 'dsh2shell-4009eb5f', 'unknown', '', null, undefined
  ]
  for (const id of ids) assert.equal(isDeepseekProvider(id), false, String(id))
})

// issue #19 给出的复现数据：5,900,672 缓存命中 / 15,979 未命中输入 / 17,534 输出，
// 型号 deepseek-v4-flash（官方别名 → deepseek-flash），空闲价 0.02 / 1 / 4 元每百万
// tokens，预期约 ¥0.20（而不是 0）。
test('the reported desktop record now costs about ¥0.20', () => {
  const seed = JSON.parse(fs.readFileSync(new URL('../lib/pricing/seed-catalog.json', import.meta.url), 'utf8'))
  const catalog = normalizeCatalog(seed).catalog
  const index = buildAliasIndex(catalog)
  assert.equal(modelKeyOf('deepseek-v4-flash'), 'deepseek-flash')
  const resolved = resolveModel('deepseek-v4-flash', 'deepseek-account', catalog, index)
  assert.equal(resolved.status, 'matched')
  assert.equal(resolved.officialModelId, 'deepseek-flash')
  const priced = priceCall({
    entry: resolved.entry,
    usage: usageOf({ inputTokens: 15979, cacheReadTokens: 5900672, outputTokens: 17534 }),
    at: Date.parse('2026-11-02T21:30:00+08:00'), // 北京时间空闲时段
    mode: 'standard'
  })
  assert.equal(priced.status, 'priced')
  assert.ok(Math.abs(priced.amountCny - 0.2041) < 0.001, String(priced.amountCny))
})
