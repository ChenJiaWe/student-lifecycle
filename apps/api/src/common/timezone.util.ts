import { addDays, addMinutes, format, parse, startOfDay } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * 业务时区固定为墨尔本，不做多时区切换（作业要求）。
 *
 * 为什么不能存 UTC 死值：墨尔本有夏令时（10 月首个周日进入 AEDT，
 * 4 月首个周日退出）。一个"每周四 16:00"的班，在切换前后 UTC 时刻
 * 相差一小时。如果按第一节课的 UTC 偏移去推算全年课次，切换之后
 * 全部错开一小时。
 *
 * 正确做法：存墙钟时间（"16:00"）+ 时区 + weekday，生成课次时把
 * (具体日期, 墙钟时间, 时区) 解析成那一刻真实的 UTC 瞬时。
 */
export const BUSINESS_TZ = 'Australia/Melbourne';

/**
 * 把某一天的墨尔本墙钟时间解析成 UTC 瞬时。
 *
 * @param date      日期（只取年月日部分）
 * @param localTime 墨尔本本地时间 "HH:mm"
 */
export function melbourneWallClockToUtc(date: Date, localTime: string): Date {
  const [h, m] = localTime.split(':').map(Number);

  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`时间格式非法: "${localTime}"，应为 HH:mm`);
  }

  // 先取该日期在墨尔本的年月日，避免服务器时区干扰
  const zoned = toZonedTime(date, BUSINESS_TZ);
  const y = zoned.getFullYear();
  const mo = String(zoned.getMonth() + 1).padStart(2, '0');
  const d = String(zoned.getDate()).padStart(2, '0');

  // fromZonedTime 会按该日期实际生效的偏移（AEST +10 / AEDT +11）换算
  return fromZonedTime(
    `${y}-${mo}-${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`,
    BUSINESS_TZ,
  );
}

/** 墨尔本视角的"今天零点"对应的 UTC 瞬时 */
export function melbourneStartOfToday(now: Date = new Date()): Date {
  const zoned = toZonedTime(now, BUSINESS_TZ);
  return melbourneWallClockToUtc(startOfDay(zoned), '00:00');
}

/** 墨尔本视角的某一天区间 [00:00, 次日 00:00) */
export function melbourneDayRange(day: Date): { start: Date; end: Date } {
  const start = melbourneWallClockToUtc(day, '00:00');
  const zoned = toZonedTime(day, BUSINESS_TZ);
  const end = melbourneWallClockToUtc(addDays(startOfDay(zoned), 1), '00:00');
  return { start, end };
}

/** 墨尔本视角的星期（0=周日 … 6=周六），与 ClassGroup.weekday 对齐 */
export function melbourneWeekday(date: Date): number {
  return toZonedTime(date, BUSINESS_TZ).getDay();
}

/** 按墨尔本时区格式化，用于展示与日志 */
export function formatMelbourne(date: Date, pattern = 'yyyy-MM-dd HH:mm'): string {
  return format(toZonedTime(date, BUSINESS_TZ), pattern);
}

/**
 * 从 anchor 起，找出未来 weeks 周内所有落在 weekday 的日期。
 * 返回的是墨尔本视角的日期，供上层配合墙钟时间生成课次。
 */
export function upcomingWeekdayDates(anchor: Date, weekday: number, weeks: number): Date[] {
  const zonedAnchor = startOfDay(toZonedTime(anchor, BUSINESS_TZ));
  const diff = (weekday - zonedAnchor.getDay() + 7) % 7;
  const first = addDays(zonedAnchor, diff);

  return Array.from({ length: weeks }, (_, i) => addDays(first, i * 7));
}

/** 课次结束时间 = 开始 + 时长 */
export function sessionEndsAt(startsAt: Date, durationMin: number): Date {
  return addMinutes(startsAt, durationMin);
}

/** 解析 "HH:mm" 为当天的 Date（仅用于比较时分，日期部分无意义） */
export function parseWallClock(localTime: string): Date {
  return parse(localTime, 'HH:mm', new Date(2000, 0, 1));
}
