import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  CheckIcon,
  ClockIcon,
  DoorOpenIcon,
  HeadphonesIcon,
  LockIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from 'lucide-react'
import { rosterQueryOptions, submitAttendance, teacherTodayQueryOptions } from '@/lib/queries'
import type { AttendanceStatus, RosterEntry, RosterSession } from '@/lib/types'
import { describeRelative, formatDay, formatTimeRange, isUpcoming } from '@/lib/datetime'
import { useNow } from '@/lib/use-now'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState } from '@/components/error-state'

export const Route = createFileRoute('/_authed/sessions/$id')({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(rosterQueryOptions(params.id)),
  component: SessionRosterPage,
})

/** 四个状态的顺序就是老师心里的顺序：先看在不在，再看迟没迟，最后区分缺勤性质 */
const STATUS_OPTIONS: Array<{
  value: AttendanceStatus
  label: string
  /** 会不会扣课时 —— 和后端 CONSUMES_CREDIT 一致 */
  consumesCredit: boolean
}> = [
  { value: 'PRESENT', label: '在', consumesCredit: true },
  { value: 'LATE', label: '迟到', consumesCredit: true },
  { value: 'ABSENT', label: '缺勤', consumesCredit: true },
  { value: 'EXCUSED', label: '请假', consumesCredit: false },
]

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: '在',
  LATE: '迟到',
  ABSENT: '缺勤',
  EXCUSED: '请假',
}

type Draft = Record<string, { status?: AttendanceStatus; note: string }>

function SessionRosterPage() {
  const { id } = Route.useParams()
  const options = rosterQueryOptions(id)
  const { data, isPending, error, refetch } = useQuery(options)

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      {isPending ? <RosterSkeleton /> : null}
      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}

      {data ? <RosterBody sessionId={id} session={data.session} roster={data.roster} /> : null}
    </div>
  )
}

function BackLink() {
  const router = useRouter()
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2.5 self-start"
      onClick={() => router.history.back()}
    >
      <ArrowLeftIcon data-icon="inline-start" />
      返回
    </Button>
  )
}

function RosterBody({
  sessionId,
  session,
  roster,
}: {
  sessionId: string
  session: RosterSession
  roster: RosterEntry[]
}) {
  const now = useNow()
  const upcoming = isUpcoming(session.startsAt, now)
  // 服务端规则 10：出勤一经提交即锁定。这里只是提前把界面切成只读，
  // 免得老师填完一屏才被 409 拒绝。
  const locked = session.attendanceTaken
  const cancelled = session.status === 'CANCELLED'

  return (
    <div className="flex flex-col gap-6">
      <SessionHeader session={session} now={now} studentCount={roster.length} />

      {roster.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersRoundIcon />
            </EmptyMedia>
            <EmptyTitle>这节课名单是空的</EmptyTitle>
            <EmptyDescription>
              还没有学生被排进这节课，所以没有可以点名的人。找教务把学生排进来。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : locked ? (
        <LockedRoster roster={roster} />
      ) : (
        <AttendanceForm
          sessionId={sessionId}
          roster={roster}
          disabled={upcoming || cancelled}
          disabledReason={
            cancelled
              ? '这节课已被取消，不能再点名。'
              : `课程 ${describeRelative(session.startsAt, now)}，开始后才能点名。`
          }
        />
      )}
    </div>
  )
}

function SessionHeader({
  session,
  now,
  studentCount,
}: {
  session: RosterSession
  now: Date
  studentCount: number
}) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold tracking-tight">{session.courseName}</h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="tabular-nums">
          {formatDay(session.startsAt)} {formatTimeRange(session.startsAt, session.endsAt)}
        </span>
        {session.room ? (
          <span className="inline-flex items-center gap-1">
            <DoorOpenIcon className="size-3.5" />
            {session.room}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <UsersRoundIcon className="size-3.5" />
          {studentCount} 人
        </span>
        <span className="inline-flex items-center gap-1">
          <ClockIcon className="size-3.5" />
          {describeRelative(session.startsAt, now)}
        </span>
      </div>
    </header>
  )
}

/** 名单上的三个信号 —— 老师走进教室前最想知道的三件事 */
function StudentTags({ entry }: { entry: RosterEntry }) {
  return (
    <>
      {entry.isFirstSession ? (
        <Badge variant="secondary">
          <SparklesIcon data-icon="inline-start" />
          首次
        </Badge>
      ) : null}
      {entry.isTrial ? (
        <Badge variant="outline">
          <HeadphonesIcon data-icon="inline-start" />
          试听生
        </Badge>
      ) : null}
      {/* 只有布尔值，没有余额数字：老师需要的是"提醒学生找顾问"这个动作，
          学生交了多少钱是教务的权限。 */}
      {entry.lowBalance ? (
        <Badge variant="destructive">
          <TriangleAlertIcon data-icon="inline-start" />
          课时将尽
        </Badge>
      ) : null}
    </>
  )
}

function LockedRoster({ roster }: { roster: RosterEntry[] }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <LockIcon />
        <AlertTitle>出勤已锁定</AlertTitle>
        <AlertDescription>
          这节课的出勤已经提交，课时也已扣除，老师不能再改。如果记错了，联系 admin 订正 ——
          订正会同时冲正课时，留下可查的记录。
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="flex flex-col gap-0 p-0">
          {roster.map((entry, index) => (
            <div key={entry.studentId}>
              {index > 0 ? <Separator /> : null}
              <div className="flex flex-col gap-1.5 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{entry.name}</span>
                  <StudentTags entry={entry} />
                  <span className="ml-auto text-sm text-muted-foreground">
                    {entry.attendance ? STATUS_LABEL[entry.attendance.status] : '未记录'}
                  </span>
                </div>
                {entry.attendance?.teacherNote ? (
                  <p className="text-sm text-muted-foreground">{entry.attendance.teacherNote}</p>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function AttendanceForm({
  sessionId,
  roster,
  disabled,
  disabledReason,
}: {
  sessionId: string
  roster: RosterEntry[]
  disabled: boolean
  disabledReason: string
}) {
  const queryClient = useQueryClient()
  const router = useRouter()

  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(roster.map((entry) => [entry.studentId, { note: '' }])),
  )
  const [confirmOpen, setConfirmOpen] = useState(false)

  const unmarked = roster.filter((entry) => !draft[entry.studentId]?.status)

  // 会被扣课时的人 —— 提交前要逐个念出名字，这是花钱的动作
  const willBeCharged = useMemo(
    () =>
      roster.filter((entry) => {
        const status = draft[entry.studentId]?.status
        if (!status || entry.isTrial) return false
        return STATUS_OPTIONS.find((option) => option.value === status)?.consumesCredit ?? false
      }),
    [roster, draft],
  )
  const trials = roster.filter((entry) => entry.isTrial)

  const submit = useMutation({
    mutationFn: () => {
      const records = roster.flatMap((entry) => {
        const row = draft[entry.studentId]
        if (!row?.status) return []
        const note = row.note.trim()
        return [
          {
            studentId: entry.studentId,
            status: row.status,
            ...(note ? { teacherNote: note } : {}),
          },
        ]
      })
      return submitAttendance(sessionId, { records })
    },
    onSuccess: async () => {
      setConfirmOpen(false)
      // 名单要变成只读，今日课程要显示"已点名" —— 两处都失效掉，
      // 让服务端说现在是什么状态，而不是前端自己猜。
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: rosterQueryOptions(sessionId).queryKey }),
        queryClient.invalidateQueries({ queryKey: teacherTodayQueryOptions.queryKey }),
      ])
      void router.invalidate()
    },
  })

  function setStatus(studentId: string, status: AttendanceStatus) {
    setDraft((previous) => ({
      ...previous,
      [studentId]: { status, note: previous[studentId]?.note ?? '' },
    }))
  }

  function setNote(studentId: string, note: string) {
    setDraft((previous) => ({
      ...previous,
      [studentId]: { status: previous[studentId]?.status, note },
    }))
  }

  function markAllPresent() {
    setDraft((previous) =>
      Object.fromEntries(
        roster.map((entry) => [
          entry.studentId,
          { status: 'PRESENT' as AttendanceStatus, note: previous[entry.studentId]?.note ?? '' },
        ]),
      ),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {disabled ? (
        <Alert>
          <ClockIcon />
          <AlertTitle>现在还不能点名</AlertTitle>
          <AlertDescription>{disabledReason}先看看名单，认一下今天的学生。</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {unmarked.length === 0 ? '全部已选' : `还有 ${unmarked.length} 人未选`}
        </p>
        <Button variant="outline" size="sm" onClick={markAllPresent} disabled={disabled}>
          全部标记为在
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-0 p-0">
          {roster.map((entry, index) => (
            <div key={entry.studentId}>
              {index > 0 ? <Separator /> : null}
              <RosterRow
                entry={entry}
                status={draft[entry.studentId]?.status}
                note={draft[entry.studentId]?.note ?? ''}
                disabled={disabled || submit.isPending}
                onStatusChange={(status) => setStatus(entry.studentId, status)}
                onNoteChange={(note) => setNote(entry.studentId, note)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 对话框关着的时候错误显示在这里；开着的时候显示在对话框里，
          免得同一条错误同时出现两遍。 */}
      {submit.error && !confirmOpen ? <ErrorState error={submit.error} /> : null}

      {disabled ? null : (
        /* 扣课时是花钱的动作，不能静默发生。这段话常驻在按钮之前，
           而且数字随勾选实时变化 —— 是本次提交的后果，不是一句免责声明。 */
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>提交后会发生什么</AlertTitle>
          <AlertDescription>
            扣除 {willBeCharged.length} 名学生各 1
            课时（在、迟到、缺勤都算用掉了这节课；请假不扣）。
            {trials.length > 0 ? ` ${trials.length} 名试听生不扣课时。` : null} 提交后出勤即锁定，
            老师不能再改。
          </AlertDescription>
        </Alert>
      )}

      <Button
        size="lg"
        className="self-start"
        disabled={disabled || unmarked.length > 0 || submit.isPending}
        onClick={() => setConfirmOpen(true)}
      >
        {submit.isPending ? <Spinner data-icon="inline-start" /> : null}
        {unmarked.length > 0 ? `还有 ${unmarked.length} 人未选` : '提交点名'}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认扣除 {willBeCharged.length} 人各 1 课时？</AlertDialogTitle>
            <AlertDialogDescription>
              {willBeCharged.length > 0
                ? `将扣课时：${willBeCharged.map((entry) => entry.name).join('、')}。`
                : '本次没有学生会被扣课时。'}
              {trials.length > 0
                ? `试听生不扣：${trials.map((entry) => entry.name).join('、')}。`
                : null}
              提交后出勤锁定，改不了 —— 需要订正只能找 admin。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submit.isPending}>再检查一下</AlertDialogCancel>
            <AlertDialogAction
              disabled={submit.isPending}
              onClick={(event) => {
                // 提交失败时对话框要留在原地把错误显示出来，不能自动关掉
                event.preventDefault()
                submit.mutate()
              }}
            >
              {submit.isPending ? <Spinner data-icon="inline-start" /> : null}
              扣课时并提交
            </AlertDialogAction>
          </AlertDialogFooter>
          {submit.error ? <ErrorState error={submit.error} /> : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function RosterRow({
  entry,
  status,
  note,
  disabled,
  onStatusChange,
  onNoteChange,
}: {
  entry: RosterEntry
  status: AttendanceStatus | undefined
  note: string
  disabled: boolean
  onStatusChange: (status: AttendanceStatus) => void
  onNoteChange: (note: string) => void
}) {
  const groupLabelId = `status-label-${entry.studentId}`

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span id={groupLabelId} className="text-sm font-medium">
          {entry.name}
        </span>
        <StudentTags entry={entry} />
        {status ? (
          <Badge variant="secondary" className="ml-auto">
            <CheckIcon data-icon="inline-start" />
            {STATUS_LABEL[status]}
          </Badge>
        ) : null}
      </div>

      <RadioGroup
        value={status ?? ''}
        onValueChange={(next) => onStatusChange(next as AttendanceStatus)}
        disabled={disabled}
        aria-labelledby={groupLabelId}
        className="flex flex-row flex-wrap gap-x-5 gap-y-2"
      >
        {STATUS_OPTIONS.map((option) => {
          const inputId = `${entry.studentId}-${option.value}`
          return (
            <label
              key={option.value}
              htmlFor={inputId}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <RadioGroupItem id={inputId} value={option.value} />
              {option.label}
            </label>
          )
        })}
      </RadioGroup>

      <Textarea
        aria-label={`给 ${entry.name} 的反馈`}
        placeholder="课堂反馈（选填）—— 家长看得到，写具体的表现比写评价更有用"
        rows={2}
        value={note}
        disabled={disabled}
        onChange={(event) => onNoteChange(event.target.value)}
      />
    </div>
  )
}

function RosterSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="正在载入名单">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-0 p-0">
          {[0, 1, 2, 3].map((row) => (
            <div key={row}>
              {row > 0 ? <Separator /> : null}
              <div className="flex flex-col gap-3 px-4 py-3.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
