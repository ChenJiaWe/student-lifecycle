import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, Check, Loader2, Phone, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { StudentStatusBadge } from '@/components/StatusBadges'
import { apiErrorMessage } from '@/lib/errors'
import { formatDateTime, formatDueLabel } from '@/lib/format'
import {
  TASK_TYPE_LABELS,
  resolveTask,
  type StudentStatus,
  type TaskCreator,
} from '@/lib/queries'
import type { TaskType } from '@/lib/types'

/**
 * 一条待跟进任务。
 *
 * 字段是 /tasks 的富形状与 /students/:id 的精简形状的并集 —— 工作台需要
 * 学生上下文（打电话要电话号码），详情页已经在这个学生名下了就不需要。
 * 用同一个组件是为了两处的"处理 / 忽略"行为完全一致：同一个确认弹窗、
 * 同一套备注规则、同一批缓存失效。
 */
export interface TaskListItem {
  id: string
  type: TaskType
  reason: string
  dueAt: string
  createdBy: TaskCreator
  /** 工作台由服务端给；详情页没有，退回本地估算（只用于显示） */
  overdueDays?: number
  isMine?: boolean
  ownerName?: string
  student?: {
    id: string
    name: string
    grade: string | null
    status: StudentStatus
    balance: number
    primaryContact: { name: string; phone: string | null; relation: string } | null
  }
  nextSession?: { startsAt: string; courseName: string } | null
}

type ResolveStatus = 'DONE' | 'DISMISSED'

function overdueDaysOf(item: TaskListItem): number {
  if (typeof item.overdueDays === 'number') return item.overdueDays
  const due = new Date(item.dueAt).getTime()
  if (Number.isNaN(due)) return 0
  return Math.max(0, Math.floor((Date.now() - due) / 86400000))
}

export function TaskList({
  items,
  showStudent = true,
  emptyHint = '没有待处理任务',
}: {
  items: TaskListItem[]
  /** 详情页已经在学生名下，不必重复学生姓名 */
  showStudent?: boolean
  emptyHint?: string
}) {
  const [pending, setPending] = useState<{ item: TaskListItem; status: ResolveStatus } | null>(null)

  if (items.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">{emptyHint}</p>
  }

  return (
    <>
      <ul className="divide-y">
        {items.map((item) => (
          <TaskRow
            key={item.id}
            item={item}
            showStudent={showStudent}
            onResolve={(status) => setPending({ item, status })}
          />
        ))}
      </ul>

      <ResolveTaskDialog pending={pending} onClose={() => setPending(null)} />
    </>
  )
}

function TaskRow({
  item,
  showStudent,
  onResolve,
}: {
  item: TaskListItem
  showStudent: boolean
  onResolve: (status: ResolveStatus) => void
}) {
  const overdue = overdueDaysOf(item)
  const student = item.student
  // isMine 由服务端给。不是自己的学生仍可查看（admin 之间要协作，同事请假时
  // 要能接手），但处理入口不出现 —— 真正的把关在服务端的 ownership 校验，
  // 这里只是别让 admin 白点一次再吃 403。
  const canAct = item.isMine !== false

  return (
    <li
      className={
        overdue > 0
          ? 'border-l-destructive bg-destructive/5 flex flex-col gap-3 border-l-2 py-3 pr-1 pl-3 sm:flex-row sm:items-center'
          : 'flex flex-col gap-3 border-l-2 border-l-transparent py-3 pr-1 pl-3 sm:flex-row sm:items-center'
      }
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {showStudent && student ? (
            <>
              <Link
                to="/students/$id"
                params={{ id: student.id }}
                className="font-medium underline-offset-4 hover:underline"
              >
                {student.name}
              </Link>
              {student.grade ? (
                <span className="text-muted-foreground text-xs">{student.grade}</span>
              ) : null}
              <StudentStatusBadge status={student.status} />
            </>
          ) : (
            <Badge variant="secondary">{TASK_TYPE_LABELS[item.type]}</Badge>
          )}

          {/* 逾期必须显著 —— 这是 admin 打开页面最该先看到的东西 */}
          {overdue > 0 ? (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              逾期 {overdue} 天
            </Badge>
          ) : (
            <span className="text-muted-foreground text-xs">{formatDueLabel(item.dueAt)}</span>
          )}

          {item.isMine === false && item.ownerName ? (
            <Badge variant="outline" className="text-muted-foreground">
              归属 {item.ownerName}
            </Badge>
          ) : null}
        </div>

        <p className="text-sm">{item.reason}</p>

        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {student?.primaryContact ? (
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {student.primaryContact.name}（{student.primaryContact.relation}）
              {student.primaryContact.phone ? ` ${student.primaryContact.phone}` : ''}
            </span>
          ) : showStudent && student ? (
            <span className="text-destructive">未登记主联系人</span>
          ) : null}

          {item.nextSession ? (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              下次课 {formatDateTime(item.nextSession.startsAt)} · {item.nextSession.courseName}
            </span>
          ) : null}

          {showStudent && student ? <span>剩 {student.balance} 课时</span> : null}
          <span>{item.createdBy === 'SYSTEM' ? '系统触发' : '手动创建'}</span>
        </div>
      </div>

      {canAct ? (
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => onResolve('DONE')}>
            <Check className="mr-1 h-3.5 w-3.5" />
            已处理
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onResolve('DISMISSED')}>
            <X className="mr-1 h-3.5 w-3.5" />
            忽略
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground shrink-0 text-xs">由 {item.ownerName} 处理</p>
      )}
    </li>
  )
}

/**
 * 处理任务要留痕。
 *
 * "已处理"的备注可选（打了电话就是打了电话），"忽略"的备注必填 ——
 * 一条任务被无声关掉，下一个接手的同事就无从知道为什么不用管了。
 * 这是表单质量要求，不是权限：服务端两者都接受可选备注。
 */
function ResolveTaskDialog({
  pending,
  onClose,
}: {
  pending: { item: TaskListItem; status: ResolveStatus } | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')

  const mutation = useMutation({
    mutationFn: (input: { id: string; status: ResolveStatus; note?: string }) =>
      resolveTask(input.id, { status: input.status, ...(input.note ? { note: input.note } : {}) }),
    onSuccess: async () => {
      // 关掉一条任务会同时影响工作台列表、概览数字和学生详情里的任务区
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['students'] }),
      ])
      close()
    },
  })

  function close() {
    setNote('')
    mutation.reset()
    onClose()
  }

  const isDismiss = pending?.status === 'DISMISSED'
  const noteMissing = isDismiss && note.trim() === ''

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isDismiss ? '忽略这条任务' : '标记为已处理'}</DialogTitle>
          <DialogDescription>
            {pending ? `${TASK_TYPE_LABELS[pending.item.type]}：${pending.item.reason}` : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="resolve-note">
            {isDismiss ? '备注（必填，说明为什么不用跟进）' : '备注（可选）'}
          </Label>
          <Textarea
            id="resolve-note"
            value={note}
            maxLength={300}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              isDismiss ? '家长已在别处续费，无需重复联系' : '已电话沟通，家长本周来交费'
            }
          />
          <p className="text-muted-foreground text-right text-xs">{note.length}/300</p>
        </div>

        {mutation.isError ? (
          <p className="text-destructive text-sm">{apiErrorMessage(mutation.error)}</p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={mutation.isPending}>
            取消
          </Button>
          <Button
            variant={isDismiss ? 'secondary' : 'default'}
            disabled={mutation.isPending || noteMissing || pending === null}
            onClick={() => {
              if (!pending) return
              mutation.mutate({
                id: pending.item.id,
                status: pending.status,
                note: note.trim() || undefined,
              })
            }}
          >
            {mutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {isDismiss ? '确认忽略' : '确认处理'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
