import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = path.join(here, '..', 'lib', 'client.js')
let mounts = 0

const fakeRequire = n => {
  if (n === 'react') return { createElement: () => null }
  throw new Error('unexpected require: ' + n)
}

async function loadClient(opts) {
  const o = opts || {}
  const storage = o.storage || {
    _d: Object.create(null),
    getItem(k) { return k in this._d ? this._d[k] : null },
    setItem(k, v) { this._d[k] = String(v) }
  }
  globalThis.window = { __ModuleLoader__: null, localStorage: storage }
  // 让默认语言检测确定化：无论运行机器系统语言如何，未显式持久化语言时都按英文环境处理
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true, writable: true })
  let captured = null
  window.__ModuleLoader__ = { load(d) { captured = d } }
  const url = pathToFileURL(CLIENT).href + '?mount=' + (++mounts) // unique: force re-eval
  await import(url)
  if (!captured) throw new Error('ModuleLoader.load was not called')
  const exports = captured.factory(fakeRequire)
  return { exports, win: window, storage }
}

test('exposes an __i18n surface through the ModuleLoader factory', async () => {
  const { exports } = await loadClient()
  assert.equal(typeof exports.__i18n, 'object')
  for (const k of ['t', 'msgText', 'setLang', 'dayLabel', 'fmtMonthLabel', 'dailyStatsTitle', 'weekdayLabels']) {
    assert.equal(typeof exports.__i18n[k], 'function', 'hook.' + k)
  }
})

test('language switch flips rendered text instantly, no network involved', async () => {
  const { exports, storage } = await loadClient()
  const i = exports.__i18n
  assert.equal(i.t('概览'), 'Overview') // non-zh environment defaults to English
  i.setLang('zh')
  assert.equal(i.t('概览'), '概览')
  i.setLang('en')
  assert.equal(i.t('概览'), 'Overview')
  // 语言不再写入 localStorage：切换只在内存生效，永远以宿主语言设置为准
  assert.equal(storage.getItem('dsh-usage-lang'), null)
})

test('dates and weekdays follow locale rules', async () => {
  const { exports } = await loadClient()
  const i = exports.__i18n
  i.setLang('en')
  assert.equal(i.dayLabel('2026-08-22'), 'Aug 22, 2026')
  assert.equal(i.fmtMonthLabel(2026, 8), 'August 2026')
  assert.deepEqual(i.weekdayLabels(), ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'])
  assert.equal(i.dailyStatsTitle(2026, 8), 'Daily stats (August 2026)')
  i.setLang('zh')
  assert.equal(i.dayLabel('2026-08-22'), '2026年8月22日')
  assert.equal(i.fmtMonthLabel(2026, 8), '2026年8月')
  assert.deepEqual(i.weekdayLabels(), ['一', '二', '三', '四', '五', '六', '日'])
  i.setLang('en')
})

test('language follows the host locale service (system settings), live', async () => {
  const { exports } = await loadClient()
  const i = exports.__i18n
  let state = { active: 'en' }
  const listeners = []
  const locale = {
    getLocale: () => state,
    subscribe: fn => { listeners.push(fn); return () => {} }
  }
  const ctx = {
    get: name => name === 'locale' ? locale : name === 'slots' ? { inject: () => {}, register: () => {} } : undefined,
    on: () => {}
  }
  exports.apply(ctx)
  assert.equal(i.t('概览'), 'Overview') // host locale en → English
  state = { active: 'zh' }
  for (const fn of listeners) fn() // host locale switched → panel re-renders instantly
  assert.equal(i.t('概览'), '概览')
  state = { active: 'en' }
  for (const fn of listeners) fn()
  assert.equal(i.t('概览'), 'Overview')
})

test('a stale dsh-usage-lang localStorage value no longer overrides the host locale', async () => {
  const storage = {
    _d: { 'dsh-usage-lang': 'en' },
    getItem(k) { return k in this._d ? this._d[k] : null },
    setItem(k, v) { this._d[k] = String(v) }
  }
  const { exports } = await loadClient({ storage })
  const i = exports.__i18n
  let state = { active: 'zh' }
  const locale = {
    getLocale: () => state,
    subscribe: () => () => {}
  }
  const ctx = {
    get: name => name === 'locale' ? locale : name === 'slots' ? { inject: () => {}, register: () => {} } : undefined,
    on: () => {}
  }
  exports.apply(ctx)
  // 旧版本曾把 “en” 写入 localStorage；现在宿主语言为 zh，插件必须显示中文
  assert.equal(i.t('概览'), '概览')
})

test('transient messages render through the current locale', async () => {
  const { exports } = await loadClient()
  const i = exports.__i18n
  const exported = { k: '已导出：', tail: '/tmp/x.csv' }
  i.setLang('en')
  assert.equal(i.msgText(exported), 'Exported: /tmp/x.csv')
  i.setLang('zh')
  assert.equal(i.msgText(exported), '已导出：/tmp/x.csv')
  const imported = { seq: [{ k: '导入成功：新增 ' }, 2, { k: ' 条，跳过重复 ' }, 1, { k: ' 条，忽略无效 ' }, 0, { k: ' 条，现有共 ' }, 100, { k: ' 条' }] }
  i.setLang('en')
  assert.equal(i.msgText(imported), 'Import OK: added 2, skipped duplicates 1, ignored invalid 0, total now 100 records')
  const validation = { errorKey: '请输入以 dop_v1_ 开头的 DigitalOcean 账户 PAT。', error: '' }
  i.setLang('en')
  assert.equal(validation.errorKey ? i.t(validation.errorKey) : validation.error, 'Enter a DigitalOcean account PAT starting with dop_v1_.')
  i.setLang('zh')
  assert.equal(validation.errorKey ? i.t(validation.errorKey) : validation.error, '请输入以 dop_v1_ 开头的 DigitalOcean 账户 PAT。')
  i.setLang('en')
})

// 回归用例来自 issue #9：周末（2026-08-23 北京时间 00:00 起）全天按空闲价，
// 星期必须取自平移后的北京时间，且生效前不得追溯打折。
const PEAK_CASES = [
  ['2026-08-23T01:30:00Z', '周日 09:30', false],
  ['2026-08-23T07:00:00Z', '周日 15:00', false],
  ['2026-08-24T01:30:00Z', '周一 09:30', true],
  ['2026-08-22T01:30:00Z', '周六 09:30（生效前）', true],
  ['2026-08-28T16:30:00Z', '周六 00:30（UTC 还是周五）', false]
]

// 统一为「模型开发方官方价」口径后新增的说明文案必须同时具备中英双语（英文界面不得残留中文）
const OFFICIAL_COPY = [
  '计价口径',
  '金额按模型开发方的官方 API 公开按量价计算，与调用经过哪个平台无关：DeepSeek 模型使用 DeepSeek 官方人民币峰谷价，其他厂商模型使用其自身官方价。官方目录中没有可靠价格的模型显示「—」，不计作 0。',
  '消耗表（按模型 · 官方价参考 · 高峰/空闲分列）',
  '消耗表（按 API 服务商 × 模型 · 官方价参考）',
  '金额为模型开发方官方 API 按量价的参考金额，与调用经过哪个平台无关；未覆盖的模型显示「—」，不按 ¥0 计。',
  'PNG 金额为等效官方价参考值，不代表实际平台账单或订阅实付金额。',
  '订阅套餐中以美元计价的月费按该 USD/CNY 汇率折算成人民币；人民币计价的套餐与官方价金额不受汇率影响。'
]

test('official-price copy is translated in both locales', async () => {
  const { exports } = await loadClient()
  const i = exports.__i18n
  i.setLang('zh')
  for (const s of OFFICIAL_COPY) assert.equal(i.t(s), s, 'zh should echo the key: ' + s.slice(0, 24))
  i.setLang('en')
  for (const s of OFFICIAL_COPY) assert.notEqual(i.t(s), s, 'missing English translation for: ' + s.slice(0, 24))
  i.setLang('en')
})

test('client isPeakNow / periodNow match the official weekend flat-rate rule (issue #9)', async () => {
  const { exports } = await loadClient()
  const i = exports.__i18n
  for (const [iso, bj, expected] of PEAK_CASES) {
    const ts = Date.parse(iso)
    assert.equal(i.isPeakNow(ts), expected, `${iso} (${bj}) isPeakNow should be ${expected ? 'peak' : 'off-peak'}`)
    const period = i.periodNow(ts)
    assert.equal(period.peak, expected, `${iso} (${bj}) periodNow.peak should be ${expected}`)
    // 周末生效后 → 「周末空闲时段」；工作日高峰 → 「工作日高峰时段」；生效前周末高峰 → 「周末高峰时段」
    if (expected === false && bj.indexOf('周日') >= 0) assert.equal(period.label, '周末空闲时段')
    if (expected === true && bj.indexOf('周一') >= 0) assert.equal(period.label, '工作日高峰时段')
    if (expected === true && bj.indexOf('生效前') >= 0) assert.equal(period.label, '周末高峰时段')
  }
})

// 1.18.0 新增的「统计口径声明」与官方价快照重算文案同样必须中英双语齐全，
// 否则英文界面会残留中文（空字符串翻译也会回退成中文，必须避免）。
const BILLING_SCOPE_STRINGS = [
  '统计口径：web_search 搜索后端未纳入精确统计',
  'DeepSeek 搜索后端调用由 Harness 用原生请求直连官方接口，响应用量未持久化到会话日志，插件无法取到实际 token。此处只记录次数，并按请求体给出输入侧下限估算：共 ',
  ' 次，估算消耗 ≥ ',
  '。搜索在服务端注入检索结果并可能多轮生成，输入与输出都会高于此值，官方账单必然更高。',
  '该部分为估算下限，请以 DeepSeek 官方后台账单为准。',
  '历史记录提示',
  ' 条无冻结官方价',
  ' 条记录没有冻结官方价快照（旧版本写入或手工导入），它们的金额按当前官方价格目录重算，目录更新后会跟着变化；新记录已冻结写入时生效的官方价快照，不受后续目录更新影响。',
  '历史记录与重算',
  ' 条记录没有冻结官方价快照（旧版本写入或手工导入），其金额按当前官方目录重算，目录更新后会跟着变化。',
  '所有记录都已冻结写入时生效的官方价快照：官方目录更新只影响之后产生的记录，历史金额不会被改写。',
  '按当前官方目录重算全部历史',
  '已提交，正在按当前官方目录重算全部历史…',
  '当前宿主不支持重算'
]

test('billing-scope and historical-pricing copy is translated in both locales', async () => {
  const { exports } = await loadClient()
  const i = exports.__i18n
  i.setLang('zh')
  for (const s of BILLING_SCOPE_STRINGS) assert.equal(i.t(s), s, 'zh should echo the key: ' + s.slice(0, 24))
  i.setLang('en')
  for (const s of BILLING_SCOPE_STRINGS) assert.notEqual(i.t(s), s, 'missing English translation for: ' + s.slice(0, 24))
  i.setLang('en')
})
