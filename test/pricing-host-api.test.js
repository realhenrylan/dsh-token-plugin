import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// 端到端（伪宿主）：计划 §5 要求"JSON 导出／导入应可往返保存新快照和状态；
// CSV 至少保留可读金额、币种、状态和来源"，以及"repriceAll 不得无提示破坏快照保证"。
// 这里用最小伪 ctx 驱动真实的 /usage/api 路由，不碰真实用户数据目录
// （DSH_USAGE_DATA_DIR 指向 mkdtemp 临时目录）。

const plugin = (await import('../lib/index.js')).default

function makeCtx() {
  const routes = {}
  const listeners = {}
  return {
    ctx: {
      get(key) {
        if (key === 'webServer') {
          return {
            register(desc) { routes[desc.path] = desc.handler }
          }
        }
        return undefined
      },
      on(event, fn) { listeners[event] = fn }
    },
    routes,
    listeners
  }
}

function fakeReq(body) {
  const handlers = {}
  queueMicrotask(() => {
    if (handlers.data) handlers.data(JSON.stringify(body))
    if (handlers.end) handlers.end()
  })
  return { on(ev, fn) { handlers[ev] = fn } }
}

function callApi(routes, body) {
  return new Promise((resolve) => {
    const res = {
      writeHead() {},
      end(text) {
        try { resolve(JSON.parse(text)) } catch (e) { resolve({ ok: false, error: 'bad json: ' + text }) }
      }
    }
    routes['/usage/api'](fakeReq(body), res)
  })
}

function snapshotOf(overrides = {}) {
  return {
    v: 1,
    sourceId: 'qwen',
    officialModelId: 'qwen3.6-27b',
    requestModel: 'qwen/qwen3.6-27b',
    provider: 'siliconflow',
    basis: 'verified-alias',
    currency: 'CNY',
    unit: 'per_1m_tokens',
    prices: { input: 3, cacheRead: 3, cacheWrite: 0, output: 18 },
    status: 'priced',
    missing: [],
    note: '',
    effective: { known: false, from: null, to: null },
    ...overrides
  }
}

async function freshPlugin(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-usage-api-'))
  const prev = process.env.DSH_USAGE_DATA_DIR
  process.env.DSH_USAGE_DATA_DIR = dir
  t.after(() => {
    if (prev === undefined) delete process.env.DSH_USAGE_DATA_DIR
    else process.env.DSH_USAGE_DATA_DIR = prev
  })
  const { ctx, routes } = makeCtx()
  plugin.apply(ctx)
  return { dir, routes }
}

test('JSON export/import round-trips the pricingSnapshot and its status', async (t) => {
  const { routes } = await freshPlugin(t)

  const imported = await callApi(routes, {
    action: 'import',
    filename: 'usage.json',
    content: JSON.stringify({
      records: [
        {
          time: 1793500000000, model: 'qwen/qwen3.6-27b', provider: 'siliconflow',
          inputTokens: 1000000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
          recordId: 'rec-priced',
          pricingSnapshot: snapshotOf()
        },
        {
          time: 1793500001000, model: 'qwen-turbo', provider: 'dashscope',
          inputTokens: 500, outputTokens: 100, recordId: 'rec-unpriced',
          pricingSnapshot: snapshotOf({
            officialModelId: 'qwen-turbo', requestModel: 'qwen-turbo', provider: 'dashscope',
            basis: 'none',
            prices: { input: null, cacheRead: null, cacheWrite: null, output: null },
            status: 'missing_price',
            missing: ['input', 'output', 'cacheRead', 'cacheWrite'],
            note: '价格页未列出文本模型，不猜价'
          })
        }
      ]
    })
  })
  assert.equal(imported.ok, true)
  assert.equal(imported.imported, 2)

  // JSON 导出：快照与状态原样往返（含 null 金额与缺项清单）
  const exp = await callApi(routes, { action: 'export', kind: 'json' })
  assert.equal(exp.ok, true)
  const data = JSON.parse(await fsp.readFile(exp.path, 'utf8'))
  const priced = data.records.find((r) => r.recordId === 'rec-priced')
  const unpriced = data.records.find((r) => r.recordId === 'rec-unpriced')
  assert.deepEqual(priced.pricingSnapshot.prices, { input: 3, cacheRead: 3, cacheWrite: 0, output: 18 })
  assert.equal(priced.pricingSnapshot.status, 'priced')
  assert.equal(unpriced.pricingSnapshot.prices.input, null)
  assert.equal(unpriced.pricingSnapshot.status, 'missing_price')
  assert.deepEqual(unpriced.pricingSnapshot.missing, ['input', 'output', 'cacheRead', 'cacheWrite'])
  assert.match(unpriced.pricingSnapshot.note, /不猜价/)
  // 目录指纹与来源状态随导出，便于核对
  assert.ok(data.official.catalogVersion != null)
  assert.ok(Array.isArray(data.official.sources))
  assert.equal(data.official.summary.priced.count, 1)
  assert.equal(data.official.summary.priced.amount, 3)
  assert.equal(data.official.summary.unpriced.count, 1)

  // 再导入同一份导出：身份键相同，全部识别为重复（往返无损）
  const reimport = await callApi(routes, {
    action: 'import', filename: 'usage.json', content: JSON.stringify(data)
  })
  assert.equal(reimport.ok, true)
  assert.equal(reimport.imported, 0)
  assert.equal(reimport.skipped, 2)
})

test('CSV keeps amount, currency, status, source and frozen marker', async (t) => {
  const { routes } = await freshPlugin(t)
  await callApi(routes, {
    action: 'import', filename: 'u.json',
    content: JSON.stringify({
      records: [
        {
          time: 1793500000000, model: 'qwen/qwen3.6-27b', provider: 'siliconflow',
          inputTokens: 1000000, outputTokens: 0, recordId: 'rec-priced',
          pricingSnapshot: snapshotOf()
        },
        {
          time: 1793500001000, model: 'qwen-turbo', provider: 'dashscope',
          inputTokens: 500, outputTokens: 100, recordId: 'rec-unpriced',
          pricingSnapshot: snapshotOf({
            officialModelId: 'qwen-turbo', requestModel: 'qwen-turbo', provider: 'dashscope',
            prices: { input: null, cacheRead: null, cacheWrite: null, output: null },
            status: 'missing_price', missing: ['input', 'output', 'cacheRead', 'cacheWrite'], note: ''
          })
        }
      ]
    })
  })
  const exp = await callApi(routes, { action: 'export', kind: 'csv' })
  assert.equal(exp.ok, true)
  const csv = await fsp.readFile(exp.path, 'utf8')
  const [header, rowPriced, rowUnpriced] = csv.split('\r\n')
  const cols = header.split(',')
  for (const name of ['officialAmount', 'officialCurrency', 'officialStatus', 'officialSource', 'officialModel', 'officialFrozen']) {
    assert.ok(cols.includes(name), 'CSV 缺列：' + name)
  }
  const cells = (row) => {
    const out = {}
    row.split(',').forEach((c, i) => { out[cols[i]] = c })
    return out
  }
  const a = cells(rowPriced)
  assert.equal(a.officialAmount, '3')
  assert.equal(a.officialCurrency, 'CNY')
  assert.equal(a.officialStatus, 'priced')
  assert.equal(a.officialSource, 'qwen')
  assert.equal(a.officialModel, 'qwen3.6-27b')
  assert.equal(a.officialFrozen, '1')
  const b = cells(rowUnpriced)
  // 无法可靠计算时金额留空（不是 0），状态列说明原因
  assert.equal(b.officialAmount, '')
  assert.equal(b.officialStatus, 'missing_price')
  assert.equal(b.officialSource, 'qwen')
})

test('repriceAll keeps official snapshots unless explicitly told otherwise', async (t) => {
  const { dir, routes } = await freshPlugin(t)
  await callApi(routes, {
    action: 'import', filename: 'u.json',
    content: JSON.stringify({
      records: [{
        time: 1793500000000, model: 'qwen/qwen3.6-27b', provider: 'siliconflow',
        inputTokens: 1000, outputTokens: 100, recordId: 'rec-keep',
        pricingSnapshot: snapshotOf()
      }]
    })
  })

  // 默认重算：不动官方价快照（目录刷新不改写历史的硬保证），但会备份
  const r1 = await callApi(routes, { action: 'repriceAll' })
  assert.equal(r1.ok, true)
  assert.equal(r1.officialDropped, 0)
  assert.ok(r1.backup)
  const backups = fs.readdirSync(path.join(dir, 'dsh-usage')).filter((n) => n.startsWith('usage-records.backup-'))
  assert.equal(backups.length, 1)
  let exp = await callApi(routes, { action: 'export', kind: 'json' })
  let data = JSON.parse(await fsp.readFile(exp.path, 'utf8'))
  assert.ok(data.records[0].pricingSnapshot)

  // 显式 includeOfficial 才允许清快照
  const r2 = await callApi(routes, { action: 'repriceAll', includeOfficial: true })
  assert.equal(r2.ok, true)
  assert.equal(r2.officialDropped, 1)
  exp = await callApi(routes, { action: 'export', kind: 'json' })
  data = JSON.parse(await fsp.readFile(exp.path, 'utf8'))
  assert.equal('pricingSnapshot' in data.records[0], false)
})

test('list exposes official summary and per-source pricing status', async (t) => {
  const { routes } = await freshPlugin(t)
  const r = await callApi(routes, { action: 'list' })
  assert.equal(r.ok, true)
  assert.ok(r.officialSummary)
  assert.equal(typeof r.officialSummary.priced.count, 'number')
  assert.ok(Array.isArray(r.pricingSources))
  assert.ok(r.pricingSources.length >= 5)
  assert.ok(r.officialCatalogVersion != null)
})
