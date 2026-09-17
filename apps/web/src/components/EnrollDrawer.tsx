import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarPlus, CheckCircle2, Clock, Loader2, Users } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ErrorState, LoadingRows } from '@/components/DataState'
import { apiErrorMessage, apiErrorStatus } from '@/lib/errors'
import { formatClassSlot } from '@/lib/format'
import { classOptionsQueryOptions, enrollStudent, type ClassOption } from '@/lib/queries'

/**
 * 排课抽屉。
 *
 * 用 Sheet 而不是跳页：排课是学生详情里的一个动作，admin 排完要回到刚才
 * 看的那一屏（余额、出勤、任务都在那儿）。跳页会丢上下文，回来还得重新
 * 滚到原位置。
 *
 * ## 三种拦截理由分别说，不统一灰掉
 *
 * blockedReason 有三种，admin 的下一步动作完全不同：
 *   - 已在此班级  → 不用管，这是个提示不是问题
 *   - 已满员      → 该找别的班，或者问老师能不能加人
 *   - 时间冲突    → 该换时段，而且必须知道跟哪个班撞了才知道换哪个
 * 统一灰掉按钮等于把这三件事说成同一件，admin 只能一个个点进去猜。
 * 所以这里按"可排 / 不可排"分区，不可排的把原因写在卡片正文里。
 *
 * warning 是另一类：可以排，但排完可能马上就要续费，现在提醒比排完再说好。
 *
 * ## 前端说人话，服务端做把关
 *
 * 这里显示的"可排"可能已经过时 —— 同事刚占掉最后一个位置。所以提交后
 * 服务端会在事务里连带行锁再校验一遍容量与冲突，409 / 403 / 422 的 message
 * 原样展示出来。前端少一次误导，但拦不住的都由服务端拦。
 */
export function EnrollDrawer({
  studentId,
  studentName,
  open,
  onOpenChange,
}: {
  studentId: string
  studentName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // enabled: 抽屉没打开就不请求 —— 容量数据没有预取的价值，它随时会变
  const optionsQuery = useQuery({ ...classOptionsQueryOptions(studentId), enabled: open })

  const enroll = useMutation({
    mutationFn: (classGroupId: string) => enrollStudent(studentId, { classGroupId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['students'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ])
    },
  })

  function close() {
    setSelectedId(null)
    enroll.reset()
    onOpenChange(false)
  }

  const options = optionsQuery.data ?? []
  const selected = options.find((o) => o.id === selectedId) ?? null
  const available = options.filter((o) => o.blockedReason === null)
  const blocked = options.filter((o) => o.blockedReason !== null)

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      {/*
        宽度必须用和 SheetContent 基类同样的 data-[side] 前缀来覆盖：基类写的是
        `data-[side=right]:sm:max-w-sm`，带属性选择器，特异性高于裸的 `sm:max-w-xl`，
        裸类名会被静默忽略。排课要同时看到时段、容量和拦截原因，384px 不够。
      */}
      <SheetContent className="flex flex-col gap-0 data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>为 {studentName} 排课</SheetTitle>
          <SheetDescription>
            选一个每周固定班，系统会生成未来两周的课次。容量与时间冲突由服务端最终校验。
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {enroll.isSuccess ? (
            <Alert className="mb-4">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>已排入「{enroll.data.className}」</AlertTitle>
              <AlertDescription>
                安排了 {enroll.data.sessionsTotal} 节课次，其中 {enroll.data.sessionsCreated}{' '}
                节新建，其余复用了同班已有的课次。
              </AlertDescription>
            </Alert>
          ) : null}

          {enroll.isError ? <EnrollError error={enroll.error} /> : null}

          {optionsQuery.isPending ? (
            <LoadingRows rows={4} />
          ) : optionsQuery.isError ? (
            <ErrorState
              error={optionsQuery.error}
              title="无法加载候选班级"
              onRetry={() => void optionsQuery.refetch()}
            />
          ) : options.length === 0 ? (
            <p className="text-muted-foreground py-10 text-center text-sm">
              目前没有开放的班级。需要先创建班级才能排课。
            </p>
          ) : (
            <div className="space-y-4">
              <section className="space-y-2">
                <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  可排（{available.length}）
                </h3>
                {available.length === 0 ? (
                  <p className="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-sm">
                    这个学生当前没有可排的班级 —— 下面每个班都标了具体原因。
                  </p>
                ) : (
                  available.map((option) => (
                    <OptionCard
                      key={option.id}
                      option={option}
                      selected={selectedId === option.id}
                      onSelect={() => {
                        setSelectedId(option.id)
                        enroll.reset()
                      }}
                    />
                  ))
                )}
              </section>

              {blocked.length > 0 ? (
                <>
                  <Separator />
                  <section className="space-y-2">
                    <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                      不可排（{blocked.length}）· 各有原因
                    </h3>
                    {blocked.map((option) => (
                      <OptionCard key={option.id} option={option} selected={false} />
                    ))}
                  </section>
                </>
              ) : null}
            </div>
          )}
        </div>

        <SheetFooter className="border-t">
          <div className="flex w-full items-center justify-between gap-3">
            <p className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
              {selected
                ? `已选：${selected.courseName} · ${formatClassSlot(
                    selected.weekday,
                    selected.startTimeLocal,
                    selected.durationMin,
                  )}`
                : '未选择班级'}
            </p>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" onClick={close} disabled={enroll.isPending}>
                {enroll.isSuccess ? '完成' : '取消'}
              </Button>
              <Button
                disabled={selected === null || enroll.isPending}
                onClick={() => {
                  if (selected) enroll.mutate(selected.id)
                }}
              >
                {enroll.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <CalendarPlus className="mr-1 h-4 w-4" />
                )}
                确认排课
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/**
 * 服务端拒绝时的表达。
 *
 * 状态码决定 admin 该做什么，所以标题按状态码分：
 *   409 → 规则拦住了（换个班 / 换时间）
 *   403 → 不是你的学生（找归属同事，改时间也没用）
 *   422 → 数据本身不满足条件（先买课时）
 * 正文一律用服务端的 message，它比前端能编的任何文案都准确。
 */
function EnrollError({ error }: { error: unknown }) {
  const status = apiErrorStatus(error)
  const title =
    status === 409
      ? '排不进去：与已有安排冲突'
      : status === 403
        ? '这不是你名下的学生'
        : status === 422
          ? '条件不满足'
          : '排课失败'

  return (
    <Alert variant="destructive" className="mb-4">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="space-y-1">
        <p>{apiErrorMessage(error)}</p>
        {status === 409 ? (
          <p className="text-xs">
            候选列表可能已过时（同事刚占掉最后一个位置）。关掉抽屉重开一次会拿到最新容量。
          </p>
        ) : null}
        {status === 403 ? (
          <p className="text-xs">可以查看，但只有归属 admin 能改。请联系该学生的归属同事。</p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

function OptionCard({
  option,
  selected,
  onSelect,
}: {
  option: ClassOption
  selected: boolean
  onSelect?: () => void
}) {
  const isBlocked = option.blockedReason !== null
  const full = option.enrolledCount >= option.capacity

  return (
    <button
      type="button"
      disabled={isBlocked}
      onClick={onSelect}
      aria-pressed={selected}
      className={[
        'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
        isBlocked
          ? 'bg-muted/40 cursor-not-allowed'
          : selected
            ? 'border-primary ring-primary/30 ring-2'
            : 'hover:bg-accent/50',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={isBlocked ? 'text-muted-foreground font-medium' : 'font-medium'}>
          {option.courseName}
        </span>
        <span className="text-muted-foreground text-sm">{option.teacherName}</span>
        <span className="text-muted-foreground ml-auto inline-flex items-center gap-1 text-xs">
          <Users className="h-3 w-3" />
          <span className={full ? 'text-destructive font-medium' : undefined}>
            {option.enrolledCount}/{option.capacity}
          </span>
        </span>
      </div>

      <p className="text-muted-foreground mt-1 inline-flex items-center gap-1 text-sm">
        <Clock className="h-3 w-3" />
        {formatClassSlot(option.weekday, option.startTimeLocal, option.durationMin)}
        <span className="text-xs">· {option.durationMin} 分钟</span>
      </p>

      {/* 不可排：把原因当正文说出来，而不是只把按钮变灰 */}
      {option.blockedReason ? (
        <p className="mt-2 flex items-start gap-1.5 text-sm">
          <Badge variant="secondary" className="shrink-0">
            不可排
          </Badge>
          <span className="text-muted-foreground">{option.blockedReason}</span>
        </p>
      ) : null}

      {/* 可排但要提醒：排完可能马上要续费 */}
      {option.warning ? (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{option.warning}</span>
        </p>
      ) : null}
    </button>
  )
}
