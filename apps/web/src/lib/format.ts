import { BUSINESS_TIMEZONE } from './datetime'

/**
 * admin 页面的展示层格式化。
 *
 * 与 datetime.ts 的分工：那边是老师视角要的东西（课次的时段、"还有多久
 * 开始"），这边是 admin 视角要的东西（金额、课时增减、截止时间的人话、
 * 固定班的每周时段）。时区常量从 datetime.ts 取，只有一个来源。
 *
 * 所有时间都显式带 timeZone 走一遍 Intl —— 不能靠浏览器本地时区，
 * 否则 admin 出差或评审在别的时区打开，课表会整体偏移几小时。
 */

/** ClassGroup.weekday 用的是 0=周日 … 6=周六 */
export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

type DateLike = string | number | Date | null | undefined

function toDate(value: DateLike): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function fmt(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: BUSINESS_TIMEZONE, ...options })
}

// hourCycle: 'h23' 而不是 hour12: false —— 后者在部分 locale 下会把午夜渲染成 24:00
const dateTimeFormatter = fmt({
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const dateFormatter = fmt({ year: 'numeric', month: 'numeric', day: 'numeric' })
const shortDateFormatter = fmt({ month: 'numeric', day: 'numeric' })
const timeFormatter = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayKeyFormatter = fmt({ year: '2-digit', month: '2-digit', day: '2-digit' })

/** "9月17日周三 16:00" —— 给"下次课"这类需要星期的场景 */
export function formatDateTime(value: DateLike, placeholder = '—'): string {
  const date = toDate(value)
  return date ? dateTimeFormatter.format(date) : placeholder
}

/** "2026/9/17" */
export function formatDate(value: DateLike, placeholder = '—'): string {
  const date = toDate(value)
  return date ? dateFormatter.format(date) : placeholder
}

/** "9/17" —— 流水、时间线这类密集列表用 */
export function formatShortDate(value: DateLike, placeholder = '—'): string {
  const date = toDate(value)
  return date ? shortDateFormatter.format(date) : placeholder
}

/**
 * "16:00"。
 *
 * 与 datetime.ts 的 formatTime 同义，但这个版本容忍 null —— admin 页面上
 * 不少时间字段是可空的（correctedAt、endDate），每处都判空太噪。
 */
export function formatTimeOfDay(value: DateLike, placeholder = '—'): string {
  const date = toDate(value)
  return date ? timeFormatter.format(date) : placeholder
}

/** 墨尔本日历日的比较键，用来判断"是不是同一天" */
function melbourneDayKey(date: Date): string {
  return dayKeyFormatter.format(date)
}

/**
 * 截止时间的人话表达。
 *
 * admin 扫列表时要的不是日期，是"还有多久"。逾期天数由服务端算
 * （overdueDays，服务端才有权威的"现在"），这里只负责把
 * "今天 / 明天 / 3 天后"说清楚。
 */
export function formatDueLabel(value: DateLike, overdueDays = 0): string {
  const date = toDate(value)
  if (!date) return '无截止'
  if (overdueDays > 0) return `逾期 ${overdueDays} 天`

  const now = new Date()
  const dueKey = melbourneDayKey(date)
  if (dueKey === melbourneDayKey(now)) return '今天到期'
  if (dueKey === melbourneDayKey(new Date(now.getTime() + 86400000))) return '明天到期'

  const days = Math.round((date.getTime() - now.getTime()) / 86400000)
  return days > 0 ? `${days} 天后到期` : `${formatShortDate(date)} 到期`
}

/**
 * amountCents 是整数分 —— 前端只负责除以 100 显示，绝不参与计算。
 * 币种跟着业务时区走（墨尔本），所以是 AUD。
 */
const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
})

export function formatMoney(amountCents: number | null | undefined): string {
  if (amountCents === null || amountCents === undefined) return '—'
  return moneyFormatter.format(amountCents / 100)
}

/** "16:00" + 90 分钟 → "17:30"。班级的 startTimeLocal 本来就是墙钟时间，不过时区 */
function addMinutesToWallClock(startTimeLocal: string, durationMin: number): string {
  const [hourRaw, minuteRaw] = startTimeLocal.split(':')
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw ?? '0')
  if (Number.isNaN(hour) || Number.isNaN(minute)) return ''

  const total = (hour * 60 + minute + durationMin) % 1440
  const endHour = Math.floor(total / 60)
  const endMinute = total % 60
  return `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`
}

/** "周三 16:00–17:30" —— 固定班的每周时段。en dash 表示区间 */
export function formatClassSlot(
  weekday: number,
  startTimeLocal: string,
  durationMin: number,
): string {
  const day = WEEKDAY_LABELS[weekday] ?? `周${weekday}`
  const end = addMinutesToWallClock(startTimeLocal, durationMin)
  return end ? `${day} ${startTimeLocal}–${end}` : `${day} ${startTimeLocal}`
}

/** 课时流水的 +2 / -1 —— 符号必须显式，admin 是在看账 */
export function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta)
}
