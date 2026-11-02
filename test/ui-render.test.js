import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 渲染冒烟测试：用最小 React 替身把视图组件的返回树真正走一遍，
// 用来兜住"语法没错、渲染时才 ReferenceError/TypeError"的情况
// （纯逻辑测试只加载模块，不会执行组件函数体）。

const here = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = path.join(here, '..', 'lib', 'client.js')
let mounts = 0

const miniReact = {
  createElement(type, props) {
    return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
  },
  useState(initial) { return [initial, function () {}] },
  useEffect() {},
  useLayoutEffect() {},
  useRef() { return { current: null } },
  useMemo(fn) { return fn() },
  useCallback(fn) { return fn },
  Fragment: 'Fragment'
}

async function loadClient() {
  const storage = { _d: Object.create(null), getItem(k) { return k in this._d ? this._d[k] : null }, setItem(k, v) { this._d[k] = String(v) } }
  globalThis.window = { __ModuleLoader__: null, localStorage: storage }
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true, writable: true })
  let captured = null
  window.__ModuleLoader__ = { load(d) { captured = d } }
  await import(pathToFileURL(CLIENT).href + '?render=' + (++mounts))
  return captured.factory((name) => {
    if (name === 'react') return miniReact
    throw new Error('unexpected require: ' + name)
  })
}

// 把返回树展开成扁平文本，顺便触发所有函数组件（子组件的 props 会被真实求值）
function flatten(node, out, depth) {
  if (depth > 40) return
  if (node == null || node === false || node === true) return
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return }
  if (Array.isArray(node)) { for (const item of node) flatten(item, out, depth + 1); return }
  if (typeof node === 'function') { flatten(node({}), out, depth + 1); return }
  if (typeof node !== 'object') return
  if (typeof node.type === 'function') {
    flatten(node.type(Object.assign({}, node.props, { children: node.children })), out, depth + 1)
    return
  }
  for (const child of node.children || []) flatten(child, out, depth + 1)
}

function sampleRecord(over) {
  const base = {
    time: Date.parse('2026-11-01T02:00:00Z'),
    pricingTime: Date.parse('2026-11-01T02:00:00Z'),
    model: 'deepseek-flash',
    provider: 'deepseek-account',
    purpose: '',
    sessionId: 's1',
    origin: 'probe',
    estimated: false,
    recordId: 'r1',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 20000,
    cacheWriteTokens: 0,
    reasoningTokens: 120,
    finishReason: 'stop',
    interrupted: false,
    modelKey: 'deepseek-flash',
    peak: true,
    official: {
      status: 'priced', amount: 0.02, currency: 'CNY', missing: [], note: '',
      partial: false, estimated: false, stale: false, sourceId: 'deepseek',
      officialModelId: 'deepseek-flash', basis: 'official-id', frozen: true
    }
  }
  return Object.assign(base, over || {})
}

function sampleDays() {
  return [{
    day: '2026-11-01', calls: 3, miss: 1000, hit: 20000, write: 0, out: 500, reason: 120,
    peakCalls: 2, offPeakCalls: 1
  }]
}

test('overview view renders without throwing', async () => {
  const { __views } = await loadClient()
  const out = []
  flatten(__views.OverviewView({
    records: [sampleRecord(), sampleRecord({ recordId: 'r2', provider: 'siliconflow', model: 'deepseek-ai/deepseek-v4-flash', peak: false })],
    toolCalls: [{ provider: 'dsh2shell-x', model: 'fake' }],
    days: sampleDays(),
    budget: { monthly: 50 },
    legacyOfficialCount: 2
  }), out, 0)
  const text = out.join(' ')
  assert.match(text, /官方价参考金额/)
  assert.match(text, /调用次数/)
  assert.match(text, /统计口径提示/)
  // 明细表格已移到「明细」页签，概览只保留趋势与结论
  assert.match(text, /消耗趋势/)
})

test('breakdown view renders both model and provider tables', async () => {
  const { __views } = await loadClient()
  const out = []
  flatten(__views.BreakdownView({
    records: [
      sampleRecord(),
      sampleRecord({ recordId: 'r2', provider: 'digitalocean', model: 'deepseek-v4-flash', peak: false })
    ]
  }), out, 0)
  const text = out.join(' ')
  // 默认按模型：出现模型名与合计行
  assert.match(text, /deepseek-flash/)
  assert.match(text, /合计/)
})

test('price view renders without throwing', async () => {
  const { __views } = await loadClient()
  const out = []
  flatten(__views.PriceView({
    fx: { rate: 7.1, inverse: 1 / 7.1, date: '2026-10-31', source: 'Frankfurter', stale: false, error: '' },
    budget: null,
    legacyOfficialCount: 0,
    onBudgetChange() {},
    onFxRefresh() {},
    onRepriceAll() {},
    onChanged() {}
  }), out, 0)
  const text = out.join(' ')
  assert.match(text, /月度预算/)
  assert.match(text, /历史记录与重算/)
  assert.match(text, /计价口径/)
})

test('calendar view renders without throwing', async () => {
  const { __views } = await loadClient()
  const out = []
  flatten(__views.CalendarView({
    records: [sampleRecord()],
    days: sampleDays()
  }), out, 0)
  const text = out.join(' ')
  assert.match(text, /本月调用|范围内调用/)
})

test('cache list view renders without throwing', async () => {
  const { __views } = await loadClient()
  const out = []
  flatten(__views.CacheListView({ records: [sampleRecord()] }), out, 0)
  assert.ok(out.length > 0)
})

test('plan month ROI uses Beijing month boundaries and excludes unpriced and interrupted calls', async () => {
  const { __views } = await loadClient()
  const bj = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const monthStart = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), 1) - 8 * 60 * 60 * 1000
  const plan = { id: 'sample-plan', name: 'Sample', currency: 'CNY', monthlyFee: 10, cycle: 'month' }
  const records = [
    { time: monthStart, channel: { kind: 'plan', planId: plan.id }, official: { amount: 20, status: 'priced' } },
    { time: monthStart + 1000, channel: { kind: 'plan', planId: plan.id }, official: { amount: 5, estimated: true } },
    { time: monthStart + 2000, channel: { kind: 'plan', planId: plan.id }, official: { amount: null } },
    { time: monthStart - 1, channel: { kind: 'plan', planId: plan.id }, official: { amount: 100 } },
    { time: monthStart + 3000, channel: { kind: 'plan', planId: 'other-plan' }, official: { amount: 200 } },
    { time: monthStart + 4000, interrupted: true, channel: { kind: 'plan', planId: plan.id }, official: { amount: 500 } }
  ]
  const first = __views.planMonthSummary(records, plan, 7)
  assert.equal(first.amount, 25)
  assert.equal(first.calls, 3)
  assert.equal(first.unpriced, 1)
  assert.equal(first.estimated, 1)
  assert.equal(first.ratio, 2.5)
  const updatedFee = __views.planMonthSummary(records, { ...plan, monthlyFee: 20 }, 7)
  assert.equal(updatedFee.amount, 25)
  assert.equal(updatedFee.ratio, 1.25)
})

test('plan views render channel amounts, manual marking, and the payment caveat', async () => {
  const { __views } = await loadClient()
  const plan = { id: 'sample-plan', name: 'Sample Plan', currency: 'CNY', monthlyFee: 10, cycle: 'month', match: { providers: ['plan-route'], models: [], excludeUnmatched: false } }
  const records = [sampleRecord({ channel: { v: 1, kind: 'plan', planId: plan.id, basis: 'manual:2026-11-02T00:00:00.000Z' } })]
  const searchRecord = sampleRecord({ recordId: 'search', purpose: 'web-search', origin: 'search-backend' })
  const output = []
  flatten(__views.PriceView({
    plans: { v: 1, plans: [plan] }, records: records.concat(searchRecord),
    pricingSources: [], officialModels: {}, budget: null, fx: { rate: 7.1 },
    onPlanSave() { return Promise.resolve({ ok: true }) }, onPlanDelete() { return Promise.resolve({ ok: true }) },
    onPlanReset() { return Promise.resolve({ ok: true }) }, onMarkChannel() { return Promise.resolve({ ok: true, marked: 1 }) }
  }), output, 0)
  const text = output.join(' ')
  assert.match(text, /订阅套餐/)
  assert.match(text, /手动标记计费通道/)
  assert.match(text, /专属 Provider ID/)
  assert.match(text, /匹配记录：1/)

  const overview = []
  flatten(__views.OverviewView({ records, plans: { v: 1, plans: [plan] }, fx: { rate: 7.1 }, days: sampleDays(), budget: null }), overview, 0)
  assert.match(overview.join(' '), /订阅回本/)
  assert.match(overview.join(' '), /不代表实付金额/)
})

test('subscription copy has English translations', async () => {
  const { __i18n } = await loadClient()
  const keys = [
    '订阅套餐', '手动标记计费通道', '计费通道金额', '订阅等效', ' 次已计价',
    '按量与订阅金额在计费通道列分开展示。', '本月按量官方价', '按通道分列', '按量/等效价',
    '计费口径提示：本报告含订阅通道记录 ', ' 条；PNG 金额沿用峰谷价口径，订阅金额请查看面板中的等效官方价，不代表实付金额。',
    '套餐登记表读取失败，原文件已保留；当前显示的是内存默认值。保存更改会在成功写入后替换无法读取的文件。',
    '订阅套餐调用显示的是等效官方价（按官方按量价折算的参考值），不代表实付金额；实付为订阅月费。'
  ]
  __i18n.setLang('en')
  for (const key of keys) assert.notEqual(__i18n.t(key), key, 'missing English text: ' + key)
})

test('client asks for a USD/CNY rate only when a plan actually needs it', async () => {
  const { __views } = await loadClient()
  const usd = { v: 1, plans: [{ id: 'p', monthlyFee: 10, currency: 'USD' }] }
  // 汇率只服务订阅套餐中以美元计价的月费：有 USD 月费且还没有汇率时才值得补拉
  assert.equal(__views.plansNeedUsdRate({ plans: usd, fx: {} }), true)
  assert.equal(__views.plansNeedUsdRate({ plans: usd, fx: { rate: 6.65 } }), false)
  assert.equal(__views.plansNeedUsdRate({ plans: { v: 1, plans: [{ id: 'p', monthlyFee: 60, currency: 'CNY' }] }, fx: {} }), false)
  assert.equal(__views.plansNeedUsdRate({ plans: { v: 1, plans: [{ id: 'p', monthlyFee: 0, currency: 'USD' }] }, fx: {} }), false)
  assert.equal(__views.plansNeedUsdRate({ plans: { v: 1, plans: [] }, fx: {} }), false)
  assert.equal(__views.plansNeedUsdRate(null), false)
})

test('plan ROI card explains a zero count when no provider id is registered', async () => {
  const { __views } = await loadClient()
  const plan = { id: 'unbound', name: 'Unbound', currency: 'USD', monthlyFee: 10, cycle: 'month', match: { providers: [], models: [], excludeUnmatched: false } }
  const out = []
  flatten(__views.OverviewView({ records: [], plans: { v: 1, plans: [plan] }, fx: { rate: 6.65 }, days: sampleDays(), budget: null }), out, 0)
  const text = out.join(' ')
  assert.match(text, /订阅回本 · Unbound/)
  assert.match(text, /尚未设置 Provider ID/)
  assert.match(text, /≈ ¥66\.5/)
})

// 回归：undici v7 的 request() 不再接受 maxRedirections，传了会直接抛
// "maxRedirections is not supported, use the redirect interceptor"，
// 导致余额查询、汇率刷新整体失败（1.22.0 线上回归）。
test('host code never passes maxRedirections to undici request()', async () => {
  const fsmod = await import('node:fs')
  const hostPath = path.join(here, '..', 'lib', 'index.js')
  const src = fsmod.readFileSync(hostPath, 'utf8')
  // 只查"作为请求选项传入"（`maxRedirections:`），注释里提到它不算
  assert.equal(/maxRedirections\s*:/.test(src), false, 'lib/index.js must not pass maxRedirections to undici')
})
