/**
 * 时间一律按业务所在地展示，与后端 BUSINESS_TIMEZONE 一致。
 *
 * 后端返回的都是 UTC ISO 串。老师看的是"墨尔本几点上课"，
 * 不是"浏览器所在时区几点" —— 出差、跨时区办公、服务器在别的地方，
 * 三种情况下都不能把时间显示错。
 */
const BUSINESS_TIMEZONE = 'Australia/Melbourne'

// h23 而不是 hour12:false —— 后者在部分 locale 下会把午夜渲染成 "24:00"
const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const dayFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BUSINESS_TIMEZONE,
  month: 'long',
  day: 'numeric',
  weekday: 'long',
})

/** "09:30" */
export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso))
}

/** "09:30–11:00"，用 en dash 而非 hyphen —— 表示区间 */
export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)}–${formatTime(endIso)}`
}

/** "9月17日星期四" */
export function formatDay(iso: string): string {
  return dayFormatter.format(new Date(iso))
}

/** 课次是否还没开始 —— 服务端规则 9 会拒绝给未开始的课点名 */
export function isUpcoming(startIso: string, now: Date = new Date()): boolean {
  return new Date(startIso).getTime() > now.getTime()
}

/** "还有 25 分钟开始" / "已进行 40 分钟" */
export function describeRelative(startIso: string, now: Date = new Date()): string {
  const minutes = Math.round((new Date(startIso).getTime() - now.getTime()) / 60000)
  if (minutes > 0) {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60)
      return `还有 ${hours} 小时 ${minutes % 60} 分钟开始`
    }
    return `还有 ${minutes} 分钟开始`
  }
  const elapsed = -minutes
  if (elapsed >= 60) return `已开始 ${Math.floor(elapsed / 60)} 小时 ${elapsed % 60} 分钟`
  return `已开始 ${elapsed} 分钟`
}

export { BUSINESS_TIMEZONE }
