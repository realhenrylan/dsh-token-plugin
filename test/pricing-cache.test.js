import test from 'node:test'
import assert from 'node:assert/strict'
import { createPricingCache, REFRESH_INTERVAL_MS, STALE_AFTER_MS } from '../lib/pricing/cache.js'
import { normalizeSampleModel } from '../lib/pricing/sources/index.js'
import { buildSourceBlock } from '../lib/pricing/sources/common.js'

// 刷新调度的硬约束（计划 §2.3 / §5.5）：并发合并、失败退避有上限、
// 失败保留上一份有效价格、24 小时标「价格可能过期」、状态可观察。

const DEFS = [
  { sourceId: 'a', vendor: 'A 官方', sourceUrl: 'https://a.example.com/pricing' },
  { sourceId: 'b', vendor: 'B 官方', sourceUrl: 'https://b.example.com/pricing' }
]

const modelSample = (id, price) => ({
  officialModelId: id,
  currency: 'CNY',
  unit: 'per_1m_tokens',
  buckets: { input: price, cacheRead: price, output: price },
  completeness: 'full'
})

/** 可控来源：fetch 计数、可排队、可失败、可返回坏结构。 */
function makeSource(sourceId, opts = {}) {
  const calls = { fetch: 0, parse: 0 }
  let release = null
  const adapter = {
    sourceId,
    sourceUrl: DEFS.find((d) => d.sourceId === sourceId).sourceUrl,
    async fetchRaw() {
      calls.fetch++
      if (opts.hold) await new Promise((r) => { release = r })
      if (opts.fetchFails) return { ok: false, error: '读取失败' }
      return { ok: true, body: 'payload', statusCode: 200, contentType: 'application/json' }
    },
    parse(raw) {
      calls.parse++
      if (opts.parseFails) return { ok: false, error: '价格表解析失配，保留上一次有效价格' }
      return buildSourceBlock({
        ok: true,
        sourceId,
        sourceUrl: adapter.sourceUrl,
        vendor: sourceId + ' 官方',
        fetchedAt: new Date(0).toISOString(),
        models: [modelSample(sourceId + '-1', opts.price == null ? 1 : opts.price)]
      }, normalizeSampleModel)
    }
  }
  return { adapter, calls, releaseHold: () => { if (release) release() } }
}

function makeCache({ a, b, clock }) {
  return createPricingCache({
    defs: DEFS,
    sources: { a: a.adapter, b: b ? b.adapter : a.adapter },
    fetcher: { get: async () => { throw new Error('测试不应出网') } },
    now: () => clock.t,
    onChange: () => { clock.changes++ }
  })
}

const clockOf = (t = Date.parse('2026-11-01T10:00:00+08:00')) => ({ t, changes: 0 })

test('a successful refresh replaces data and records the last success time', async () => {
  const clock = clockOf()
  const a = makeSource('a', { price: 2 })
  const cache = makeCache({ a, clock })
  const r = await cache.refresh(['a'], { force: true })
  assert.equal(r.ok, true)
  assert.equal(r.results[0].replaced, true)
  assert.equal(cache.catalog.sources.a.models[0].tiers[0].prices.input, 2)
  assert.equal(cache.catalog.sources.a.lastSuccessAt, clock.t)
  assert.equal(cache.isStale('a'), false)
  assert.ok(clock.changes > 0)
})

test('a parse failure keeps the last good prices and says so', async () => {
  const clock = clockOf()
  const a = makeSource('a', { price: 2 })
  const cache = makeCache({ a, clock })
  await cache.refresh(['a'], { force: true })
  // 模拟解析器失配（结构异常）：必须拒绝替换上一次有效数据
  a.adapter.parse = () => { a.calls.parse++; return { ok: false, error: '价格表解析失配，保留上一次有效价格' } }
  clock.t += 1000
  const r = await cache.refresh(['a'], { force: true })
  assert.equal(r.ok, false)
  assert.ok(r.results[0].error.indexOf('保留上一次有效价格') >= 0)
  assert.equal(cache.catalog.sources.a.models[0].tiers[0].prices.input, 2, '失败不得覆盖有效数据')
  const s = cache.statuses().find((x) => x.sourceId === 'a')
  assert.ok(s.lastError.indexOf('保留上一次有效价格') >= 0)
})

test('concurrent refreshes of one source are merged into a single fetch', async () => {
  const clock = clockOf()
  const a = makeSource('a', { hold: true })
  const cache = makeCache({ a, clock })
  const p1 = cache.refresh(['a'], { force: true })
  const p2 = cache.refresh(['a'], { force: true })
  a.releaseHold()
  const [r1, r2] = await Promise.all([p1, p2])
  assert.equal(a.calls.fetch, 1, '同一来源的并发刷新必须合并')
  assert.equal(r1.results[0].replaced, true)
  assert.equal(r2.results[0].replaced, true)
})

test('failure backs off with a cap and never retries at call frequency', async () => {
  const clock = clockOf()
  const a = makeSource('a')
  a.adapter.fetchRaw = async () => { a.calls.fetch++; return { ok: false, error: '读取失败' } }
  const cache = makeCache({ a, clock })
  await cache.refresh(['a'], { force: true })
  assert.equal(a.calls.fetch, 1)
  // 退避期内不重试（非 force）
  clock.t += 60 * 1000
  const blocked = await cache.refresh(['a'])
  assert.equal(blocked.results[0].error, '退避重试中，稍后再试')
  assert.equal(a.calls.fetch, 1)
  // 退避期后允许重试；失败次数越多退避越长，但有上限
  let waited = 0
  let backoffs = []
  for (let i = 0; i < 8; i++) {
    const before = clock.t
    await cache.refresh(['a'])
    const rt = cache.statuses().find((x) => x.sourceId === 'a')
    backoffs.push(rt.retryAfterAt - before)
    clock.t = rt.retryAfterAt
    waited = rt.retryAfterAt
  }
  const max = Math.max(...backoffs)
  assert.ok(max <= 6 * 60 * 60 * 1000, '退避上限 6 小时，实际 ' + max)
  assert.ok(max >= 5 * 60 * 1000, '首次退避不少于 5 分钟')
})

test('data older than 24h is flagged stale, older than 6h is due for refresh', async () => {
  const clock = clockOf()
  const a = makeSource('a')
  const cache = makeCache({ a, clock })
  await cache.refresh(['a'], { force: true })
  clock.t += REFRESH_INTERVAL_MS - 1
  assert.equal(cache.shouldRefresh('a'), false)
  clock.t += 2
  assert.equal(cache.shouldRefresh('a'), true, '6 小时到期应触发刷新')
  assert.equal(cache.isStale('a'), false, '24 小时内不算过期')
  clock.t += STALE_AFTER_MS - (REFRESH_INTERVAL_MS) + 1
  assert.equal(cache.isStale('a'), true, '超过 24 小时未成功 → 价格可能过期')
  const s = cache.statuses().find((x) => x.sourceId === 'a')
  assert.equal(s.stale, true)
})

test('a never-successful source is 「暂无价格」 and stale', async () => {
  const clock = clockOf()
  const a = makeSource('a')
  const cache = makeCache({ a, clock })
  const s = cache.statuses().find((x) => x.sourceId === 'a')
  assert.equal(s.state, 'never')
  assert.equal(s.available, false)
  assert.equal(cache.isStale('a'), true)
})

test('restore keeps a persisted snapshot but rejects an invalid one', async () => {
  const clock = clockOf()
  const a = makeSource('a', { price: 3 })
  const cache = makeCache({ a, clock })
  await cache.refresh(['a'], { force: true })
  const snapshot = cache.snapshot()
  const fresh = makeCache({ a, clock })
  assert.equal(fresh.restore(snapshot).ok, true)
  assert.equal(fresh.catalog.sources.a.models[0].tiers[0].prices.input, 3)
  const broken = makeCache({ a, clock })
  const bad = broken.restore({ catalogVersion: 999, updatedAt: 1, sources: { a: { sourceId: 'a', status: 'ok', models: 'not-an-array' } } })
  assert.equal(bad.ok, false)
  assert.equal(broken.catalog.sources.a.models.length, 0, '坏快照不得半截生效')
})

test('statuses expose per-source state, links and last success', async () => {
  const clock = clockOf()
  const a = makeSource('a')
  const b = makeSource('b')
  const cache = makeCache({ a, b, clock })
  await cache.refresh(['a'], { force: true })
  const s = cache.statuses()
  assert.equal(s.length, 2)
  const sa = s.find((x) => x.sourceId === 'a')
  const sb = s.find((x) => x.sourceId === 'b')
  assert.equal(sa.state, 'ok')
  assert.equal(sa.lastSuccessAt, clock.t)
  assert.equal(sa.sourceUrl, 'https://a.example.com/pricing')
  assert.equal(sb.state, 'never', '各来源状态独立')
})
