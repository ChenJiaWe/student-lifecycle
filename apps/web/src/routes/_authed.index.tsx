import { useState, type ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, CheckCircle2, UserRound, Users } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState, ErrorState, LoadingRows } from '@/components/DataState'
import { TaskList } from '@/components/TaskList'
import {
  taskFeedQueryOptions,
  taskOverviewQueryOptions,
  type TaskGroup,
  type TaskScope,
} from '@/lib/queries'

export const Route = createFileRoute('/_authed/')({
  component: WorkbenchPage,
})

/**
 * admin 工作台。
 *
 * ## 这里不是学生表格
 *
 * admin 早上打开系统，问题不是"我有哪些学生"，而是"谁快掉队了"。一张
 * 87 行的表回答不了第二个问题 —— 它把判断的工作又推回给人：翻、比、记。
 * 所以首页只放需要动作的那几条，87 个学生藏在 /students 二级页面。
 *
 * 这也是为什么后端把待跟进做成了实体（FollowUpTask）而不是一个查询条件：
 * 任务有归属、有截止、有处理记录，所以"谁该管、什么时候该管完、上次是
 * 怎么处理的"都有答案。工作台只是把这张表按类型摊开。
 */
function WorkbenchPage() {
  // scope 用组件状态而不是 URL search —— 这是个视图偏好，不是需要分享的位置
  const [scope, setScope] = useState<TaskScope>('mine')

  const feed = useQuery(taskFeedQueryOptions(scope))
  const overview = useQuery(taskOverviewQueryOptions)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">今日待跟进</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            系统按试听、课时、出勤自动开出的任务。处理完一条就消失一条。
          </p>
        </div>

        {/* 默认只看自己名下的 —— 别人的任务不是你的工作。同事请假时切到"全部"接手 */}
        <Tabs value={scope} onValueChange={(value) => setScope(value as TaskScope)}>
          <TabsList>
            <TabsTrigger value="mine">我的</TabsTrigger>
            <TabsTrigger value="all">全部 admin</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {feed.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-9 w-48" />
          <Card>
            <CardContent className="pt-6">
              <LoadingRows rows={4} />
            </CardContent>
          </Card>
        </div>
      ) : feed.isError ? (
        <ErrorState
          error={feed.error}
          title="待跟进列表加载失败"
          onRetry={() => void feed.refetch()}
        />
      ) : feed.data.groups.length === 0 ? (
        /**
         * 空态不是"暂无数据"。
         *
         * 工作台空了是好消息：今天该联系的人都联系过了。但 admin 不该
         * 因此撞到一面墙 —— 给他一个明确的下一步。
         */
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8 text-emerald-600" />}
          title="今天没有待处理的学生"
          description={
            scope === 'mine'
              ? '你名下的试听跟进、课时续费、出勤风险都清空了。新任务会在老师点名后自动出现。'
              : '全部 admin 名下都没有待处理任务。'
          }
          action={
            <Button asChild variant="outline">
              <Link to="/students">看我的学生</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {/* 逾期是整页最该先被看到的数字，所以顶在分区之上 */}
          {feed.data.overdue > 0 ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{feed.data.overdue} 条已逾期</AlertTitle>
              <AlertDescription>
                共 {feed.data.total} 条待跟进，其中 {feed.data.overdue}{' '}
                条已过截止时间。逾期的在下面各分区里标红置顶。
              </AlertDescription>
            </Alert>
          ) : (
            <p className="text-muted-foreground text-sm">
              共 {feed.data.total} 条待跟进，没有逾期的。
            </p>
          )}

          {feed.data.groups.map((group) => (
            <TaskGroupCard key={group.type} group={group} />
          ))}
        </div>
      )}

      {/* 概览数字放页面下方：它是背景信息，不是待办。放顶上会抢走任务的注意力 */}
      <section className="space-y-3">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          我的概览
        </h2>

        {overview.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : overview.isError ? (
          <ErrorState
            error={overview.error}
            title="概览数字加载失败"
            onRetry={() => void overview.refetch()}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              icon={<Users className="h-4 w-4" />}
              label="我名下的学生"
              value={overview.data.studentCount}
            />
            <StatTile
              icon={<AlertTriangle className="h-4 w-4" />}
              label="待处理任务"
              value={overview.data.openTasks}
            />
            <StatTile
              icon={<CalendarDays className="h-4 w-4" />}
              label="未来 7 天课次"
              value={overview.data.weekSessions}
            />
            <StatTile
              icon={<UserRound className="h-4 w-4" />}
              label="待试听"
              value={overview.data.pendingTrials}
            />
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * 按类型分区，不是一条长列表。
 *
 * 四类任务的动作完全不同：试听跟进是问要不要报名，课时将尽是谈续费，
 * 连续缺勤是问还来不来。混成一列，admin 每条都得先读一遍才知道
 * 该用什么语气打这个电话。
 */
function TaskGroupCard({ group }: { group: TaskGroup }) {
  const overdueCount = group.items.filter((item) => item.overdueDays > 0).length

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {group.label}
          <Badge variant="secondary">{group.items.length}</Badge>
          {overdueCount > 0 ? (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {overdueCount} 条逾期
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <TaskList items={group.items} />
      </CardContent>
    </Card>
  )
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: number
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <span className="bg-muted text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-muted-foreground truncate text-xs">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}
