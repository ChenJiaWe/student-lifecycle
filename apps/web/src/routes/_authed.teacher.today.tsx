import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { CalendarOffIcon, CheckIcon, ClockIcon, DoorOpenIcon, UsersIcon } from 'lucide-react'
import { teacherTodayQueryOptions } from '@/lib/queries'
import type { TeacherSession } from '@/lib/types'
import { describeRelative, formatDay, formatTimeRange, isUpcoming } from '@/lib/datetime'
import { useNow } from '@/lib/use-now'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'

export const Route = createFileRoute('/_authed/teacher/today')({
  loader: ({ context }) => context.queryClient.ensureQueryData(teacherTodayQueryOptions),
  component: TeacherTodayPage,
})

function TeacherTodayPage() {
  // loader 已经预取过，这里读的是同一份缓存 —— 不会再打一次接口，
  // 但组件仍然是响应式的：点完名回来能看到状态变了。
  const { data: sessions, isPending, error, refetch } = useQuery(teacherTodayQueryOptions)
  const now = useNow()

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">今日课程</h1>
        <p className="text-sm text-muted-foreground">
          {sessions?.[0] ? formatDay(sessions[0].startsAt) : '墨尔本时间'}
          {sessions ? ` · ${sessions.length} 节` : null}
        </p>
      </header>

      {isPending ? <TodaySkeleton /> : null}

      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}

      {sessions && sessions.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarOffIcon />
            </EmptyMedia>
            <EmptyTitle>今天没有你的课</EmptyTitle>
            <EmptyDescription>
              排课由教务负责。如果你觉得这里少了一节课，找教务确认课表。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {sessions && sessions.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {sessions.map((session) => (
            <li key={session.id}>
              <SessionCard session={session} now={now} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

const SESSION_TYPE_LABEL: Record<TeacherSession['type'], string> = {
  REGULAR: '正式课',
  TRIAL: '试听课',
  MAKEUP: '补课',
}

function SessionCard({ session, now }: { session: TeacherSession; now: Date }) {
  const upcoming = isUpcoming(session.startsAt, now)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
        {/* 时间在最左、最大、等宽对齐 —— 老师扫这一页时先找的是"下一节几点"，
            课程名是确认，不是入口。 */}
        <div className="flex shrink-0 flex-col gap-0.5 sm:w-28">
          <span className="text-base font-semibold tabular-nums tracking-tight">
            {formatTimeRange(session.startsAt, session.endsAt)}
          </span>
          <span className="text-xs text-muted-foreground">
            {describeRelative(session.startsAt, now)}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-medium">{session.courseName}</h2>
            {session.type === 'REGULAR' ? null : (
              <Badge variant="secondary">{SESSION_TYPE_LABEL[session.type]}</Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <UsersIcon className="size-3.5" />
              {session.studentCount} 人
            </span>
            {session.room ? (
              <span className="inline-flex items-center gap-1">
                <DoorOpenIcon className="size-3.5" />
                {session.room}
              </span>
            ) : null}
          </div>

          {upcoming ? (
            <p className="inline-flex items-start gap-1.5 text-xs text-muted-foreground">
              <ClockIcon className="mt-px size-3.5 shrink-0" />
              课程开始后才能点名。现在可以先看名单，认一下今天的新同学。
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:self-center">
          {session.attendanceTaken ? (
            <>
              <Badge variant="outline">
                <CheckIcon data-icon="inline-start" />
                已点名
              </Badge>
              <Button asChild variant="ghost" size="sm">
                <Link to="/sessions/$id" params={{ id: session.id }}>
                  查看
                </Link>
              </Button>
            </>
          ) : (
            <Button asChild variant={upcoming ? 'outline' : 'default'} size="sm">
              <Link to="/sessions/$id" params={{ id: session.id }}>
                {upcoming ? '看名单' : '点名'}
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function TodaySkeleton() {
  return (
    <ul className="flex flex-col gap-3" aria-busy="true" aria-label="正在载入今日课程">
      {[0, 1, 2].map((row) => (
        <li key={row}>
          <Card>
            <CardContent className="flex items-start gap-5">
              <Skeleton className="h-5 w-24 shrink-0" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-7 w-16 shrink-0" />
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}
