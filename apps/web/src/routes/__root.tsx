import type { QueryClient } from '@tanstack/react-query'
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { ErrorState } from '@/components/error-state'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Button } from '@/components/ui/button'

/**
 * queryClient 通过路由 context 传给每个 loader，这样 loader 和组件
 * 读的是同一份缓存，而不是各自取一次。
 */
export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: ({ error, reset }) => (
    <div className="mx-auto w-full max-w-lg px-6 py-24">
      <ErrorState error={error} onRetry={reset} />
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto w-full max-w-lg px-6 py-24">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>这个地址没有对应的页面</EmptyTitle>
          <EmptyDescription>链接可能已经变了，从首页重新进入。</EmptyDescription>
        </EmptyHeader>
        <Button asChild variant="outline">
          <Link to="/login">回到登录</Link>
        </Button>
      </Empty>
    </div>
  ),
})

function RootLayout() {
  return <Outlet />
}
