import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CalendarIcon, PhoneIcon, RefreshCwIcon, UserIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDay, formatTimeRange } from '@/lib/datetime'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_authed/trials')({
  component: TrialsPage,
})

interface TrialRecord {
  studentId: string
  studentName: string
  grade: string | null
  studentStatus: string
  sessionId: string
  startsAt: string
  endsAt: string
  room: string | null
  teacherName: string
  attended: boolean
  attendanceStatus: string | null
  teacherNote: string | null
  isPast: boolean
  primaryContact: { name: string; phone: string | null; wechat: string | null; relation: string } | null
}

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  PRESENT: { label: '已到课', variant: 'default' },
  ABSENT: { label: '缺席', variant: 'destructive' },
  LATE: { label: '迟到', variant: 'secondary' },
  EXCUSED: { label: '请假', variant: 'outline' },
}

function TrialCard({ trial }: { trial: TrialRecord }) {
  const statusBadge = trial.attendanceStatus ? STATUS_LABELS[trial.attendanceStatus] : null

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to="/students/$id"
              params={{ id: trial.studentId }}
              className="font-semibold text-base hover:underline truncate block"
            >
              {trial.studentName}
            </Link>
            {trial.grade && (
              <p className="text-sm text-muted-foreground mt-0.5">{trial.grade}</p>
            )}
          </div>
          <div className="flex flex-shrink-0 gap-1.5">
            {trial.isPast ? (
              statusBadge ? (
                <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              ) : (
                <Badge variant="secondary">未点名</Badge>
              )
            ) : (
              <Badge variant="outline">待试听</Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {/* 课次信息 */}
        <div className="flex items-center gap-2 text-muted-foreground">
          <CalendarIcon className="size-3.5 shrink-0" />
          <span>
            {formatDay(trial.startsAt)}
            {'  '}
            {formatTimeRange(trial.startsAt, trial.endsAt)}
            {trial.room && <span className="ml-2 text-xs">· {trial.room}</span>}
          </span>
        </div>

        <div className="flex items-center gap-2 text-muted-foreground">
          <UserIcon className="size-3.5 shrink-0" />
          <span>授课：{trial.teacherName}</span>
        </div>

        {/* 老师反馈 */}
        {trial.teacherNote && (
          <div className="rounded-md bg-muted/50 px-3 py-2">
            <p className="text-xs text-muted-foreground mb-1">老师反馈</p>
            <p className="text-sm leading-snug">{trial.teacherNote}</p>
          </div>
        )}

        {/* 联系人 */}
        {trial.primaryContact && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <PhoneIcon className="size-3.5 shrink-0" />
            <span>
              {trial.primaryContact.relation}
              {' · '}
              {trial.primaryContact.name}
              {trial.primaryContact.phone && (
                <span className="ml-2 font-mono text-xs select-all">{trial.primaryContact.phone}</span>
              )}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TrialsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-16 mt-1" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function TrialsPage() {
  const qc = useQueryClient()

  const { data: trials, isLoading, error } = useQuery({
    queryKey: ['trials'],
    queryFn: () => api<TrialRecord[]>('/trials'),
  })

  const extendMutation = useMutation({
    mutationFn: () => api<{ groupsChecked: number; sessionsCreated: number }>('/sessions/extend-upcoming', { method: 'POST' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['trials'] }) },
  })

  if (isLoading) return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-9 w-28" />
      </div>
      <TrialsSkeleton />
    </div>
  )

  if (error) return (
    <div className="container max-w-5xl py-8">
      <Alert variant="destructive">
        <AlertDescription>加载试听列表失败，请刷新重试。</AlertDescription>
      </Alert>
    </div>
  )

  const upcoming = (trials ?? []).filter((t: TrialRecord) => !t.isPast)
  const past = (trials ?? []).filter((t: TrialRecord) => t.isPast)
  const needsFollowup = past.filter((t: TrialRecord) => t.attended && t.studentStatus === 'TRIAL_ATTENDED')

  return (
    <div className="container max-w-5xl py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">试听管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {upcoming.length} 节待试听 · {needsFollowup.length} 名待跟进
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => extendMutation.mutate()}
          disabled={extendMutation.isPending}
        >
          <RefreshCwIcon className={`size-4 mr-2 ${extendMutation.isPending ? 'animate-spin' : ''}`} />
          补全未来课次
        </Button>
      </div>

      {extendMutation.data && (
        <Alert>
          <AlertDescription>
            已补全：检查 {extendMutation.data.groupsChecked} 个班，新建 {extendMutation.data.sessionsCreated} 节课次。
          </AlertDescription>
        </Alert>
      )}

      {/* 待试听 */}
      {upcoming.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-base font-medium text-muted-foreground">即将试听</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map(t => <TrialCard key={t.sessionId} trial={t} />)}
          </div>
        </section>
      )}

      {/* 待跟进（试听后未报名） */}
      {needsFollowup.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-base font-medium text-muted-foreground">试听后待跟进</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {needsFollowup.map(t => <TrialCard key={t.sessionId} trial={t} />)}
          </div>
        </section>
      )}

      {/* 历史记录 */}
      {past.filter(t => !needsFollowup.includes(t)).length > 0 && (
        <section className="space-y-4">
          <h2 className="text-base font-medium text-muted-foreground">历史试听</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {past.filter(t => !needsFollowup.includes(t)).map(t => <TrialCard key={t.sessionId} trial={t} />)}
          </div>
        </section>
      )}

      {/* 空态 */}
      {(trials ?? []).length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">还没有试听记录。</p>
          <p className="text-sm text-muted-foreground mt-1">
            从学生详情页安排试听后，记录会显示在这里。
          </p>
        </div>
      )}
    </div>
  )
}
