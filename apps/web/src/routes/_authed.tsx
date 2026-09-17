import { useMutation } from '@tanstack/react-query'
import { Link, Outlet, createFileRoute, isRedirect, redirect } from '@tanstack/react-router'
import { LogOutIcon } from 'lucide-react'
import { ApiError } from '@/lib/api'
import { logout, meQueryOptions } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ErrorState } from '@/components/error-state'

/**
 * 登录后页面的公共外壳 + 守卫。
 *
 * 注意这只是体验层：真正的把关在服务端的 JwtAuthGuard / RolesGuard 上。
 * 这里做的事是"别让人看到一个空壳页面再被 401 打回来"，
 * 所以不在前端复刻任何权限判断 —— 角色能做什么由服务端说。
 */
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context, location }) => {
    try {
      const user = await context.queryClient.ensureQueryData(meQueryOptions)
      // 放进 context，子路由的 loader 和组件都能直接拿到
      return { user }
    } catch (error) {
      // redirect() 是靠抛异常工作的。这个 catch 不能把它吞掉，
      // 否则"主动跳转"会被当成"加载失败"。
      if (isRedirect(error)) throw error

      // 只有"确实没登录"才送去登录页。后端没起来、网线掉了也会让
      // /auth/me 失败，那种情况下跳登录页只会让人以为密码错了 ——
      // 应该原样把错误抛给 errorComponent，说清楚是连不上。
      if (error instanceof ApiError && error.isUnauthorized) {
        throw redirect({ to: '/login', search: { redirect: location.href } })
      }
      throw error
    }
  },
  component: AuthedLayout,
  errorComponent: ({ error, reset }) => (
    <div className="mx-auto w-full max-w-lg px-6 py-24">
      <ErrorState error={error} onRetry={reset} />
    </div>
  ),
})

function AuthedLayout() {
  const { user } = Route.useRouteContext()

  const signOut = useMutation({
    mutationFn: logout,
    // 无论服务端怎么回，本地都要回到登录页并丢掉所有缓存。
    // 整页跳转是最干净的做法：没有任何组件还握着上一个人的数据。
    onSettled: () => window.location.assign('/login'),
  })

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-4 px-6 py-3">
          {/* 老师的首页是今日课程，用类型化的 Link；admin 工作台在 "/"，
              那条路由不在本文件的归属范围内，所以走普通 <a>，
              免得这里的类型检查依赖另一个人还没提交的路由。 */}
          {user.role === 'TEACHER' ? (
            <Link to="/teacher/today" className="text-sm font-semibold tracking-tight">
              教务控制台
            </Link>
          ) : (
            <a href="/" className="text-sm font-semibold tracking-tight">
              教务控制台
            </a>
          )}
          {user.role === 'ADMIN' && (
            <nav className="flex items-center gap-4 ml-4">
              <Link to="/students" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                学生
              </Link>
              <Link to="/trials" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                试听
              </Link>
            </nav>
          )}
          <span className="ml-auto text-sm text-muted-foreground">
            {user.name}
            <span className="ml-2 text-xs">{user.role === 'TEACHER' ? '老师' : '教务'}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
          >
            {signOut.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <LogOutIcon data-icon="inline-start" />
            )}
            退出
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
