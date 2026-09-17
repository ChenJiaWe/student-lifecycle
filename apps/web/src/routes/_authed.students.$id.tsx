import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarPlus,
  CreditCard,
  Info,
  Mail,
  MessageCircle,
  Phone,
  Wallet,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ErrorState, LoadingRows } from '@/components/DataState'
import { AttendanceStatusBadge, StudentStatusBadge } from '@/components/StatusBadges'
import { CreditLedgerTimeline } from '@/components/CreditLedger'
import { EnrollDrawer } from '@/components/EnrollDrawer'
import { PurchaseCreditsDialog } from '@/components/PurchaseCreditsDialog'
import { StudentDigest } from '@/components/StudentDigest'
import { TaskList } from '@/components/TaskList'
import { formatClassSlot, formatDate, formatDateTime } from '@/lib/format'
import { studentDetailQueryOptions, type GuardianLink, type StudentDetail } from '@/lib/queries'

export const Route = createFileRoute('/_authed/students/$id')({
  component: StudentDetailPage,
})

/**
 * 学生详情 —— 一页看全。
 *
 * 不做 Tab 分页：admin 打这个电话时要同时知道"还剩几节课""上次老师说
 * 什么""下节课什么时候"。分到三个 Tab 里，每接一个家长电话就要点三下，
 * 而且第三下的时候已经忘了第一下看到什么。所以纵向排布，全部铺开。
 *
 * 接口也是一个 —— 服务端一次把联系人、课时流水、在读班级、出勤、任务
 * 全拼好返回，前端不用打五个接口再自己 join。
 */
function StudentDetailPage() {
  const { id } = Route.useParams()
  const detail = useQuery(studentDetailQueryOptions(id))
  const [enrollOpen, setEnrollOpen] = useState(false)

  if (detail.isPending) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="py-6">
            <LoadingRows rows={2} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6">
            <LoadingRows rows={5} />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (detail.isError) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState
          error={detail.error}
          title="学生信息加载失败"
          onRetry={() => void detail.refetch()}
        />
      </div>
    )
  }

  const student = detail.data
  const balance = student.credits.balance ?? student.account?.balance ?? 0
  const threshold = student.credits.lowBalanceThreshold ?? student.account?.lowBalanceThreshold ?? 4

  return (
    <div className="space-y-5">
      <BackLink />

      <StudentHeader student={student} onEnroll={() => setEnrollOpen(true)} />

      {/* 余额告警放最顶上：这是唯一一条"现在就该做点什么"的信息 */}
      {student.credits.isLow ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>课时将尽</AlertTitle>
          <AlertDescription>
            剩余 {balance} 课时，已低于提醒阈值 {threshold}。再上 {Math.max(balance, 0)}{' '}
            节课就会被系统拒绝扣课时（数据库不允许负余额），需要先联系家长续费。
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <ContactsCard guardians={student.guardians} />
        <CreditsCard
          student={student}
          balance={balance}
          threshold={threshold}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <EnrollmentsCard student={student} onEnroll={() => setEnrollOpen(true)} />
        <TasksCard student={student} />
      </div>

      <AttendanceCard student={student} />

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          续费沟通
        </h2>
        <StudentDigest studentId={student.id} />
      </section>

      <EnrollDrawer
        studentId={student.id}
        studentName={student.name}
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
      />
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/students"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      返回学生列表
    </Link>
  )
}

function StudentHeader({
  student,
  onEnroll,
}: {
  student: StudentDetail
  onEnroll: () => void
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-4 py-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{student.name}</h1>
            {student.grade ? <Badge variant="outline">{student.grade}</Badge> : null}
            <StudentStatusBadge status={student.status} />
          </div>

          <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span>归属 {student.ownerAdmin.name}</span>
            {student.source ? <span>来源 {student.source}</span> : null}
            <span>建档 {formatDate(student.createdAt)}</span>
          </div>

          {student.note ? <p className="max-w-2xl text-sm">{student.note}</p> : null}
        </div>

        {/**
         * 不是自己的学生：写入口不出现，但明确说明为什么，并给出下一步
         * （找归属同事）。灰掉一个按钮不解释，admin 只会以为系统坏了。
         */}
        {student.isMine ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onEnroll}>
              <CalendarPlus className="mr-1 h-4 w-4" />
              排课
            </Button>
            <PurchaseCreditsDialog
              studentId={student.id}
              studentName={student.name}
              trigger={
                <Button>
                  <CreditCard className="mr-1 h-4 w-4" />
                  购买课时
                </Button>
              }
            />
          </div>
        ) : (
          <Alert className="max-w-xs">
            <Info className="h-4 w-4" />
            <AlertTitle>只读</AlertTitle>
            <AlertDescription className="text-xs">
              这个学生归 {student.ownerAdmin.name}。你可以查看全部信息，但排课、续费、处理任务
              需要由归属 admin 操作。
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * 联系人。
 *
 * 家长 ≠ 学生 ≠ 付款人 —— 这个区分必须在界面上看得见：
 * 打电话找主联系人，谈钱找付款人，两个人经常不是同一个（爷爷接送、
 * 妈妈付钱的情况很常见）。所以两种身份各有徽标，且当二者不同时
 * 主动提示一句，免得 admin 对着接送的人谈续费。
 */
function ContactsCard({ guardians }: { guardians: GuardianLink[] }) {
  const primary = guardians.find((g) => g.isPrimaryContact)
  const payer = guardians.find((g) => g.isPayer)
  const splitRoles = primary && payer && primary.guardian.id !== payer.guardian.id

  return (
    <Card className="lg:col-span-1">
      <CardHeader>
        <CardTitle className="text-base">联系人</CardTitle>
        <CardDescription>打电话找主联系人，谈钱找付款人。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {guardians.length === 0 ? (
          <p className="text-destructive text-sm">
            没有登记联系人 —— 这意味着任务开出来也联系不上人，建议先补录。
          </p>
        ) : (
          <>
            {splitRoles ? (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  主联系人是{primary.guardian.name}（{primary.relation}），付款人是
                  {payer.guardian.name}（{payer.relation}）—— 续费要找后者。
                </AlertDescription>
              </Alert>
            ) : null}

            <ul className="space-y-3">
              {guardians.map((link) => (
                <li key={`${link.guardian.id}-${link.relation}`} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{link.guardian.name}</span>
                    <span className="text-muted-foreground text-xs">{link.relation}</span>
                    {link.isPrimaryContact ? <Badge>主联系人</Badge> : null}
                    {link.isPayer ? <Badge variant="secondary">付款人</Badge> : null}
                  </div>

                  <div className="text-muted-foreground flex flex-col gap-0.5 text-sm">
                    {link.guardian.phone ? (
                      <a
                        href={`tel:${link.guardian.phone}`}
                        className="inline-flex items-center gap-1.5 hover:underline"
                      >
                        <Phone className="h-3 w-3" />
                        {link.guardian.phone}
                      </a>
                    ) : null}
                    {link.guardian.wechat ? (
                      <span className="inline-flex items-center gap-1.5">
                        <MessageCircle className="h-3 w-3" />
                        {link.guardian.wechat}
                      </span>
                    ) : null}
                    {link.guardian.email ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="h-3 w-3" />
                        {link.guardian.email}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * 课时区。
 *
 * 余额只是个引子，主体是流水 —— 见 CreditLedgerTimeline 里的说明。
 */
function CreditsCard({
  student,
  balance,
  threshold,
}: {
  student: StudentDetail
  balance: number
  threshold: number
}) {
  const ledger = student.credits.ledger ?? []

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">课时</CardTitle>
            <CardDescription>
              流水是账，不是日志 —— 家长问"我这 20 节课怎么用掉的"，答案在这里。
            </CardDescription>
          </div>
          {student.isMine ? (
            <PurchaseCreditsDialog
              studentId={student.id}
              studentName={student.name}
              trigger={
                <Button variant="outline" size="sm">
                  <CreditCard className="mr-1 h-3.5 w-3.5" />
                  购买课时
                </Button>
              }
            />
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2">
            <Wallet className="text-muted-foreground h-4 w-4 self-center" />
            <span
              className={
                student.credits.isLow
                  ? 'text-destructive text-3xl font-semibold tabular-nums'
                  : 'text-3xl font-semibold tabular-nums'
              }
            >
              {balance}
            </span>
            <span className="text-muted-foreground text-sm">剩余课时</span>
          </div>
          <span className="text-muted-foreground text-xs">提醒阈值 {threshold}</span>
        </div>

        <Separator />

        <CreditLedgerTimeline entries={ledger} />

        {ledger.length >= 30 ? (
          <p className="text-muted-foreground text-xs">只显示最近 30 条流水。</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function EnrollmentsCard({
  student,
  onEnroll,
}: {
  student: StudentDetail
  onEnroll: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">在读班级</CardTitle>
            <CardDescription>每周固定时段。时间按墨尔本显示。</CardDescription>
          </div>
          {student.isMine ? (
            <Button variant="outline" size="sm" onClick={onEnroll}>
              <CalendarPlus className="mr-1 h-3.5 w-3.5" />
              排课
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {student.enrollments.length === 0 ? (
          <div className="space-y-3 py-4 text-center">
            <p className="text-muted-foreground text-sm">还没有在读班级。</p>
            {student.isMine ? (
              <Button variant="outline" size="sm" onClick={onEnroll}>
                排进一个班
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y">
            {student.enrollments.map((enrollment) => {
              const group = enrollment.classGroup
              return (
                <li key={enrollment.id} className="space-y-1 py-2.5 first:pt-0 last:pb-0">
                  {group ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{group.course.name}</span>
                        {group.course.subject ? (
                          <Badge variant="outline" className="text-xs">
                            {group.course.subject}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {formatClassSlot(group.weekday, group.startTimeLocal, group.durationMin)} ·{' '}
                        {group.teacher.name}
                        {group.room ? ` · ${group.room}` : ''}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground text-sm">班级信息缺失</p>
                  )}
                  <p className="text-muted-foreground text-xs">
                    入班 {formatDate(enrollment.startDate)}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function TasksCard({ student }: { student: StudentDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          待跟进任务
          {student.tasks.length > 0 ? (
            <Badge variant="secondary">{student.tasks.length}</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>与工作台是同一批任务，在这儿处理等效。</CardDescription>
      </CardHeader>
      <CardContent>
        <TaskList
          items={student.tasks.map((task) => ({ ...task, isMine: student.isMine }))}
          showStudent={false}
          emptyHint="这个学生没有待跟进的事项。"
        />
      </CardContent>
    </Card>
  )
}

/**
 * 最近出勤与反馈。
 *
 * correctedAt 非空的记录要标出来 —— 出勤一经提交老师就不能改，能改的
 * 只有 admin，且必填原因、走反向记账。所以"这条被订正过"是有审计意义的
 * 信息，不能静默地只显示订正后的结果。
 */
function AttendanceCard({ student }: { student: StudentDetail }) {
  const stats = student.attendanceStats

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">最近出勤与反馈</CardTitle>
        <CardDescription>
          最近 {stats.total} 次 · 到课 {stats.present} · 迟到 {stats.late} · 缺勤 {stats.absent} ·
          请假 {stats.excused}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {student.attendance.length === 0 ? (
          <p className="text-muted-foreground px-6 py-8 text-center text-sm">
            还没有出勤记录。老师第一次点名后会出现在这里。
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>上课时间</TableHead>
                <TableHead>课程</TableHead>
                <TableHead>出勤</TableHead>
                <TableHead>老师反馈</TableHead>
                <TableHead>记录人</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {student.attendance.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatDateTime(record.session.startsAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {record.session.classGroup?.course.name ??
                      (record.session.type === 'TRIAL' ? '试听课' : '—')}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <AttendanceStatusBadge status={record.status} />
                      {record.correctedAt ? (
                        <Badge variant="outline" className="text-xs">
                          已订正
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-sm text-sm">
                    {record.teacherNote ? (
                      <span>{record.teacherNote}</span>
                    ) : (
                      <span className="text-muted-foreground italic">未填写</span>
                    )}
                    {record.correctionNote ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        订正原因：{record.correctionNote}（{formatDateTime(record.correctedAt)}）
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                    {record.recordedBy?.name ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
