/**
 * 由 test/fixtures/pricing/*.sample.json（第一阶段人工核验样本）生成
 * lib/pricing/seed-catalog.json —— 插件首次启动时的种子价格目录。
 *
 * 种子数据**不是**"实时官方价格"：每个条目保留样本的 fetchedAt 与
 * priceVersion=seed:…，运行时刷新成功后会被真实抓取结果替换；
 * 刷新失败则按缓存规则保留并标注时效。
 *
 * 用法：node scripts/build-pricing-seed.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSourceAdapters, SOURCE_DEFS } from '../lib/pricing/sources/index.js'
import { normalizeCatalog, CATALOG_VERSION } from '../lib/pricing/catalog.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const adapters = createSourceAdapters()
const sources = {}
const problems = []

for (const def of SOURCE_DEFS) {
  const fixture = resolve(root, 'test', 'fixtures', 'pricing', def.sourceId + '.sample.json')
  if (!existsSync(fixture)) {
    problems.push(def.sourceId + ': 缺少样本 ' + fixture)
    continue
  }
  const sample = JSON.parse(readFileSync(fixture, 'utf8'))
  const parsed = adapters[def.sourceId].parse({ ok: true, body: JSON.stringify(sample), contentType: 'application/json', statusCode: 200 })
  if (!parsed || !parsed.ok) {
    problems.push(def.sourceId + ': 样本解析失败 — ' + (parsed && parsed.error))
    continue
  }
  const block = parsed.block
  block.lastSuccessAt = Date.parse(sample.fetchedAt) || Date.now()
  block.lastAttemptAt = block.lastSuccessAt
  block.lastError = ''
  block.priceVersion = 'seed:verified:' + String(sample.fetchedAt || '').slice(0, 10)
  block.seeded = true
  sources[def.sourceId] = block
}

const catalog = { catalogVersion: CATALOG_VERSION, updatedAt: Date.now(), sources }
const checked = normalizeCatalog(catalog)
if (!checked.ok) {
  console.error('[build-pricing-seed] 目录校验失败：')
  for (const e of checked.errors) console.error('  - ' + e)
  process.exit(1)
}
for (const p of problems) console.error('[build-pricing-seed] 警告：' + p)
const out = resolve(root, 'lib', 'pricing', 'seed-catalog.json')
writeFileSync(out, JSON.stringify(checked.catalog, null, 2), 'utf8')
console.log('[build-pricing-seed] 已写入 ' + out)
for (const [id, s] of Object.entries(checked.catalog.sources)) {
  console.log('  ' + id + ': ' + s.models.length + ' 个型号, status=' + s.status)
}
