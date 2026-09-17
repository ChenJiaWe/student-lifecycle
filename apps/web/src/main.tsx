import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { ApiError, setUnauthorizedHandler } from '@/lib/api'
import { routeTree } from './routeTree.gen'
import '@/styles/globals.css'

/** 4xx 是服务端在说"这个请求本身不对"，重试只是把同一个错再打三遍 */
function retryOnlyServerFaults(failureCount: number, error: unknown) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < 2
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: retryOnlyServerFaults,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
})

const router = createRouter({
  routeTree,
  // loader 通过 context 拿到同一个 queryClient，和组件读同一份缓存
  context: { queryClient },
  defaultPreload: 'intent',
  // 数据的新鲜度由 query 缓存管，路由层不要再缓存一层
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

/**
 * api 层不认识路由，它只知道"这次请求被判定为未登录"。
 * 这里把那个信号翻译成一次跳转，并带上当前地址，登录后能回到原处。
 *
 * 首次进页面的未登录由 _authed 的 beforeLoad 处理；这个回调兜的是
 * 会话中途过期 —— 后台刷新、提交点名时才发现 cookie 已经没了。
 */
setUnauthorizedHandler(() => {
  const current = router.state.location.href
  if (current.startsWith('/login')) return
  void router.navigate({ to: '/login', search: { redirect: current }, replace: true })
})

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('找不到 #root，index.html 被改坏了')

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
