import { AlertTriangleIcon, PlugZapIcon, ShieldXIcon } from 'lucide-react'
import { ApiError } from '@/lib/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * 后端的状态码是有语义的，不是"失败了"的三种写法：
 *   403 你的角色不允许  ·  409 规则不允许（比如重复点名）
 *   422 当前状态不允许（比如课还没开始）  ·  400 你传的东西不对
 * 所以标题按状态码分，正文一律用服务端的 message —— 那句话是规则本身
 * 写的，比前端猜的任何文案都准。
 */
function titleFor(error: unknown): string {
  if (!(error instanceof ApiError)) return '出了点问题'
  switch (error.status) {
    case 0:
      return '连不上服务器'
    case 400:
      return '提交的内容不符合要求'
    case 403:
      return '你没有这个操作的权限'
    case 404:
      return '找不到这条记录'
    case 409:
      return '和现有记录冲突'
    case 422:
      return '当前状态不允许这个操作'
    default:
      return error.status >= 500 ? '服务端出错了' : '请求没有通过'
  }
}

function IconFor({ error }: { error: unknown }) {
  if (error instanceof ApiError) {
    if (error.isOffline) return <PlugZapIcon />
    if (error.status === 403) return <ShieldXIcon />
  }
  return <AlertTriangleIcon />
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '没有更多信息。刷新页面再试一次。'
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
}) {
  // 403 重试一百次还是 403 —— 只有"可能是暂时的"才给重试按钮
  const worthRetrying =
    !(error instanceof ApiError) || error.isOffline || error.status >= 500 || error.status === 409

  return (
    <Alert variant="destructive" className={className}>
      <IconFor error={error} />
      <AlertTitle>{titleFor(error)}</AlertTitle>
      <AlertDescription>{messageOf(error)}</AlertDescription>
      {onRetry && worthRetrying ? (
        <AlertDescription>
          <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
            重试
          </Button>
        </AlertDescription>
      ) : null}
    </Alert>
  )
}
