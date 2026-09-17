import type { ReactNode } from 'react'
import { AlertCircle, Inbox, WifiOff } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { apiErrorMessage, isOffline } from '@/lib/errors'

/**
 * 三态的统一出口：loading / 空 / 错误。
 *
 * 抽出来不是为了省行数，是为了**空态不退化成"暂无数据"**。空态是产品的
 * 一部分：工作台空了说明今天没人要跟进（好事，该引导去看学生列表），
 * 学生列表空了说明筛选条件太窄（该给个清除按钮）。两种空要说不同的话，
 * 所以 title 必填、action 可传。
 */

export function LoadingRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={className ?? 'space-y-3'} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <div className="text-muted-foreground">{icon ?? <Inbox className="h-8 w-8" />}</div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="text-muted-foreground max-w-sm text-sm">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/**
 * 错误态一律把服务端的话原样展示 —— 409「与已排课程「数学 A」时间冲突」
 * 比"请求失败"有用得多。
 *
 * 断网和"服务端拒绝了你"分开说：前者重试有意义，后者重试只会再被拒一次。
 */
export function ErrorState({
  error,
  onRetry,
  title,
}: {
  error: unknown
  onRetry?: () => void
  title?: string
}) {
  const offline = isOffline(error)

  return (
    <Alert variant="destructive">
      {offline ? <WifiOff className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      <AlertTitle>{title ?? (offline ? '连不上服务器' : '加载失败')}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{apiErrorMessage(error, '未知错误')}</p>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            重试
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
