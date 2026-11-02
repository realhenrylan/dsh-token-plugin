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
  const { ctx, routes, listeners } = makeCtx()
  plugin.apply(ctx)
  return { dir, routes, listeners }
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
          channel: { v: 1, kind: 'plan', planId: 'opencode-go', basis: 'provider:verified-route' },
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
  assert.deepEqual(priced.channel, { v: 1, kind: 'plan', planId: 'opencode-go', basis: 'provider:verified-route' })
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
  assert.equal(data.official.summary.channels.plans['opencode-go'].priced.count, 1)
  assert.equal(data.official.summary.channels.perToken.unpriced.count, 1)

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
          channel: { v: 1, kind: 'plan', planId: 'opencode-go' },
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
  assert.ok(cols.includes('计费通道'))
  for (const name of ['officialAmount', 'officialCurrency', 'officialStatus', 'officialSource', 'officialModel', 'officialFrozen']) {
    assert.ok(cols.includes(name), 'CSV 缺列：' + name)
  }
  const cells = (row) => {
    const out = {}
    row.split(',').forEach((c, i) => { out[cols[i]] = c })
    return out
  }
  const a = cells(rowPriced)
  assert.equal(a['计费通道'], 'plan:opencode-go')
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

  const csvImport = await callApi(routes, {
    action: 'import', filename: 'channel.csv',
    content: [
      'time,model,provider,计费通道,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,reasoningTokens,finishReason',
      '1793600000000,model-from-csv,verified-route,plan:csv-plan,8,2,0,0,0,stop'
    ].join('\n')
  })
  assert.equal(csvImport.ok, true)
  const list = await callApi(routes, { action: 'list' })
  const imported = list.records.find((r) => r.model === 'model-from-csv')
  assert.deepEqual(imported.channel, { v: 1, kind: 'plan', planId: 'csv-plan' })
})

test('repriceAll backs up records before recomputing official snapshots', async (t) => {
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

  // 重算语义：先备份，再清掉全部官方价快照，让它们按当前官方目录重新计算
  const r1 = await callApi(routes, { action: 'repriceAll' })
  assert.equal(r1.ok, true)
  assert.equal(r1.officialDropped, 1)
  assert.ok(r1.backup)
  const backups = fs.readdirSync(path.join(dir, 'dsh-usage')).filter((n) => n.startsWith('usage-records.backup-'))
  assert.equal(backups.length, 1)
  const exp = await callApi(routes, { action: 'export', kind: 'json' })
  const data = JSON.parse(await fsp.readFile(exp.path, 'utf8'))
  assert.equal('pricingSnapshot' in data.records[0], false)

  // 清掉快照后仍能按当前官方目录给出可追溯的计价结果（不会退化成 0）
  const list = await callApi(routes, { action: 'list' })
  assert.equal(list.ok, true)
  assert.ok(list.records[0].official)
  assert.equal(typeof list.records[0].official.status, 'string')
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

test('plans API persists registrations and manual channel marks round-trip', async (t) => {
  const { dir, routes } = await freshPlugin(t)
  const before = await callApi(routes, { action: 'stat' })
  const initial = await callApi(routes, { action: 'list' })
  assert.deepEqual(initial.plans.plans.map((plan) => plan.id), ['opencode-go', 'command-code-goat'])
  assert.ok(initial.plans.plans.every((plan) => plan.match.providers.length === 0))

  const plan = {
    id: 'verified-plan', name: 'Verified Plan', currency: 'CNY', monthlyFee: 60, cycle: 'month',
    match: { providers: ['verified-route'], models: [], excludeUnmatched: false }, sourceUrl: '', note: ''
  }
  const saved = await callApi(routes, { action: 'plans', op: 'save', plan })
  assert.equal(saved.ok, true)
  assert.equal((await callApi(routes, { action: 'stat' })).pricingVersion > before.pricingVersion, true)
  const plansFile = path.join(dir, 'dsh-usage', 'plans.json')
  const storedPlanText = await fsp.readFile(plansFile, 'utf8')
  assert.equal(JSON.parse(storedPlanText).plans.find((row) => row.id === plan.id).monthlyFee, 60)
  const rejected = await callApi(routes, { action: 'plans', op: 'save', plan: { ...plan, monthlyFee: -1 } })
  assert.equal(rejected.ok, false)
  assert.equal(await fsp.readFile(plansFile, 'utf8'), storedPlanText)

  const usageDir = path.join(dir, 'dsh-usage')
  const movedUsageDir = path.join(dir, 'dsh-usage-preserved')
  await fsp.rename(usageDir, movedUsageDir)
  await fsp.writeFile(usageDir, 'blocker', 'utf8')
  const writeFailure = await callApi(routes, { action: 'plans', op: 'save', plan: { ...plan, monthlyFee: 90 } })
  assert.equal(writeFailure.ok, false)
  assert.match(writeFailure.error, /套餐登记表写入失败/)
  assert.equal((await callApi(routes, { action: 'plans', op: 'get' })).plans.plans.find((row) => row.id === plan.id).monthlyFee, 60)
  await fsp.unlink(usageDir)
  await fsp.rename(movedUsageDir, usageDir)
  assert.equal(await fsp.readFile(plansFile, 'utf8'), storedPlanText)

  await callApi(routes, {
    action: 'import', filename: 'calls.json',
    content: JSON.stringify({ records: [
      { time: 1793600000100, model: 'm1', provider: 'verified-route', sessionId: 'session-one', inputTokens: 1, recordId: 'mark-one' },
      { time: 1793600000200, model: 'm2', provider: 'verified-route', sessionId: 'session-two', inputTokens: 1, recordId: 'mark-two' }
    ] })
  })
  const marked = await callApi(routes, { action: 'markChannel', kind: 'plan', planId: plan.id, sessionId: 'session-one' })
  assert.equal(marked.ok, true)
  assert.equal(marked.marked, 1)
  let list = await callApi(routes, { action: 'list' })
  assert.deepEqual(list.records.find((r) => r.recordId === 'mark-one').channel.kind, 'plan')
  assert.equal(list.records.find((r) => r.recordId === 'mark-one').channel.planId, plan.id)
  assert.match(list.records.find((r) => r.recordId === 'mark-one').channel.basis, /^manual:/)
  assert.equal('channel' in list.records.find((r) => r.recordId === 'mark-two'), false)

  const dateMarked = await callApi(routes, { action: 'markChannel', kind: 'per_token', from: 1793600000000, to: 1793600000300 })
  assert.equal(dateMarked.ok, true)
  assert.equal(dateMarked.marked, 2)
  list = await callApi(routes, { action: 'list' })
  assert.deepEqual(list.records.find((r) => r.recordId === 'mark-two').channel.kind, 'per_token')
  assert.match(list.records.find((r) => r.recordId === 'mark-two').channel.basis, /^manual:/)
  const storedRecords = JSON.parse(await fsp.readFile(path.join(dir, 'dsh-usage', 'usage-records.json'), 'utf8'))
  assert.equal(storedRecords.find((r) => r.recordId === 'mark-one').channel.kind, 'per_token')

  const cleared = await callApi(routes, { action: 'markChannel', kind: 'unmarked', sessionId: 'session-one' })
  assert.equal(cleared.marked, 1)
  list = await callApi(routes, { action: 'list' })
  assert.equal('channel' in list.records.find((r) => r.recordId === 'mark-one'), false)

  const deleted = await callApi(routes, { action: 'plans', op: 'delete', id: plan.id })
  assert.equal(deleted.ok, true)
  const afterDelete = await callApi(routes, { action: 'list' })
  assert.equal(afterDelete.records.some((r) => r.recordId === 'mark-two'), true)
  assert.equal(afterDelete.plans.plans.some((row) => row.id === plan.id), false)
})

test('an invalid plans.json is preserved and surfaced to the client', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-plans-corrupt-'))
  const usageDir = path.join(dir, 'dsh-usage')
  await fsp.mkdir(usageDir, { recursive: true })
  const plansFile = path.join(usageDir, 'plans.json')
  await fsp.writeFile(plansFile, '{invalid registry', 'utf8')
  const prev = process.env.DSH_USAGE_DATA_DIR
  process.env.DSH_USAGE_DATA_DIR = dir
  t.after(() => {
    if (prev === undefined) delete process.env.DSH_USAGE_DATA_DIR
    else process.env.DSH_USAGE_DATA_DIR = prev
  })
  const { ctx, routes } = makeCtx()
  plugin.apply(ctx)
  const list = await callApi(routes, { action: 'list' })
  assert.match(list.plansError, /套餐登记表 JSON 无效/)
  assert.equal(await fsp.readFile(plansFile, 'utf8'), '{invalid registry')
})

test('web_search backend events do not receive plan channel attribution', async (t) => {
  const { routes, listeners } = await freshPlugin(t)
  const plan = {
    id: 'deepseek-route-plan', name: 'DeepSeek Route Plan', currency: 'CNY', monthlyFee: 20, cycle: 'month',
    match: { providers: ['deepseek-official'], models: [], excludeUnmatched: false }, sourceUrl: '', note: ''
  }
  assert.equal((await callApi(routes, { action: 'plans', op: 'save', plan })).ok, true)
  listeners['session/event']({ id: 'search-session' }, {
    time: 1793600000000,
    type: 'web/deepseek-search-llm-request',
    data: {
      endpoint: 'https://api.deepseek.com/anthropic/v1/messages',
      body: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'search request' }] }
    }
  })
  const list = await callApi(routes, { action: 'list' })
  let search = list.records.find((record) => record.purpose === 'web-search')
  assert.ok(search)
  assert.equal(search.provider, 'deepseek-official')
  assert.equal('channel' in search, false)
  const marked = await callApi(routes, {
    action: 'markChannel', kind: 'plan', planId: plan.id, sessionId: 'search-session'
  })
  assert.equal(marked.marked, 0)
  search = (await callApi(routes, { action: 'list' })).records.find((record) => record.purpose === 'web-search')
  assert.equal('channel' in search, false)
})
