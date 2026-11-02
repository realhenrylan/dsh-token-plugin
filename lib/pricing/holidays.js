/**
 * dsh-usage-plugin — 中国法定节假日日历（外部来源，非厂商价格页）。
 *
 * DeepSeek 官方价目写明高峰时段排除「中国法定节假日」，但官方页面不提供
 * 日历（已核验缺口）。这里收录**有出处**的放假安排，并标注覆盖年份：
 * 超出覆盖年份时引擎不静默假定"不是节假日"，而是报"时段规则不完整"。
 *
 * 来源：国务院办公厅《关于 2026 年部分节假日安排的通知》（含调休连休段，
 * 只列放假日期；调休上班的周末按官方口径仍属周末 → 空闲价）。
 *
 * @module dsh-usage-plugin/pricing/holidays
 */

export const CN_HOLIDAYS = Object.freeze({
  2026: Object.freeze([
    '2026-01-01', '2026-01-02', '2026-01-03',
    '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
    '2026-04-04', '2026-04-05', '2026-04-06',
    '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
    '2026-06-19', '2026-06-20', '2026-06-21',
    '2026-09-25', '2026-09-26', '2026-09-27',
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'
  ])
})

export const CN_HOLIDAY_SOURCE = '国务院办公厅《关于 2026 年部分节假日安排的通知》'

/** 目录 periods.holidays 形状的节假日规则（带覆盖年份与出处）。 */
export function holidayRule() {
  const coveredYears = Object.keys(CN_HOLIDAYS).map(Number).sort()
  const days = []
  for (const y of coveredYears) days.push(...CN_HOLIDAYS[y])
  return {
    days,
    coveredYears,
    source: CN_HOLIDAY_SOURCE,
    calendarPublishedOnVendorSource: false
  }
}
