/**
 * 与 Nest 后端之间唯一的 HTTP 通道。
 *
 * 两个约定贯穿全站：
 *   1. `credentials: 'include'` —— 凭据是 httpOnly cookie，token 不进 JS，
 *      所以每个请求都必须显式带上 cookie。
 *   2. 后端的错误码是有语义的（403 权限 / 409 规则冲突 / 422 状态不允许 /
 *      400 输入非法），所以这里把状态码和 message 原样保留成 ApiError，
 *      交给界面决定怎么说人话，而不是在这里压成一句"请求失败"。
 */

/** 后端错误体：Nest 的 HttpException 序列化结果 */
interface ApiErrorBody {
  message?: string | string[]
  error?: string
  statusCode?: number
}

export class ApiError extends Error {
  constructor(
    /** HTTP 状态码；0 表示请求没能到达服务器 */
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  get isUnauthorized() {
    return this.status === 401
  }

  /** 网络层失败（服务没起来、断网），区别于"服务端明确拒绝了你" */
  get isOffline() {
    return this.status === 0
  }
}

/**
 * 会话过期时的统一出口。由 main.tsx 注入路由跳转 —— api 层不该知道路由长什么样。
 */
type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null

export function setUnauthorizedHandler(handler: UnauthorizedHandler) {
  onUnauthorized = handler
}

function messageFrom(body: ApiErrorBody | null, status: number): string {
  const raw = body?.message
  if (Array.isArray(raw) && raw.length > 0) return raw.join('；')
  if (typeof raw === 'string' && raw.trim()) return raw
  return `请求失败（HTTP ${status}）`
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  /** 要发送的 JSON 体，自动序列化并补上 Content-Type */
  json?: unknown
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { json, headers, ...rest } = options

  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...rest,
      // 凭据在 httpOnly cookie 里，不带就等于没登录
      credentials: 'include',
      headers: {
        ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    })
  } catch {
    throw new ApiError(0, '连不上服务器。确认后端已在 http://localhost:3000 运行，然后重试。')
  }

  if (response.status === 204) return undefined as T

  const body = (await response.json().catch(() => null)) as ApiErrorBody | null

  if (response.status === 401) {
    // /auth/* 上的 401 是"这次登录没通过"，服务端的 message 就是答案。
    // 其他端点上的 401 是"会话没了"，那句话得由前端说 —— 服务端只会回
    // 一句 "Unauthorized"，对用户没有意义。
    if (path.startsWith('/auth/')) {
      throw new ApiError(401, messageFrom(body, 401))
    }
    onUnauthorized?.()
    throw new ApiError(401, '登录已过期，请重新登录。')
  }

  if (!response.ok) {
    throw new ApiError(response.status, messageFrom(body, response.status))
  }

  return body as T
}
