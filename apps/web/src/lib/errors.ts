import { ApiError } from './api'

/**
 * 服务端错误 → 给 admin 看的一句话。
 *
 * 规则的把关全在 NestJS：排课冲突 409、不是你的学生 403、余额不足 422，
 * 而后端给的 message 本身就是人话（"与已排课程「数学 A」时间冲突"）。
 * 前端的职责是**把服务端的话原样说出来**，而不是自己编一套文案 ——
 * 编一套就等于在前端复制一遍业务规则，两边迟早不一致。
 *
 * api.ts 已经把状态码和 message 保留在 ApiError 里了，这里只做取用。
 */

export function apiErrorStatus(err: unknown): number | null {
  return err instanceof ApiError ? err.status : null
}

export function apiErrorMessage(err: unknown, fallback = '操作失败，请重试'): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error && err.message.trim()) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return fallback
}

/**
 * 403 要单独识别 —— "时间冲突"和"这不是你的学生"是两种完全不同的处境。
 * 前者 admin 该换时段，后者该找归属同事，说成同一句话等于没说。
 */
export function isForbidden(err: unknown): boolean {
  return apiErrorStatus(err) === 403
}

/** 网络层失败：服务没起来 / 断网，不是服务端拒绝了你 */
export function isOffline(err: unknown): boolean {
  return err instanceof ApiError && err.isOffline
}
