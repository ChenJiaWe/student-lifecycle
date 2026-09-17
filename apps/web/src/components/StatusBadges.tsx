import { Badge } from '@/components/ui/badge'
import {
  ATTENDANCE_STATUS_LABELS,
  STUDENT_STATUS_LABELS,
  type StudentStatus,
} from '@/lib/queries'
import type { AttendanceStatus } from '@/lib/types'

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

/**
 * 状态色只用来分"要不要管"，不做彩虹。
 *
 * 内部后台每天看八小时，把七个学生状态各配一个颜色只会让真正需要注意的
 * AT_RISK 淹掉。所以：风险/流失用 destructive，试听流程中用 default（要推进），
 * 在读用 outline（正常，不抢眼），其余 secondary。
 */
const STUDENT_STATUS_VARIANT: Record<StudentStatus, BadgeVariant> = {
  INQUIRY: 'secondary',
  TRIAL_SCHEDULED: 'default',
  TRIAL_ATTENDED: 'default',
  ENROLLED: 'outline',
  AT_RISK: 'destructive',
  CHURNED: 'destructive',
  LOST: 'secondary',
}

export function StudentStatusBadge({ status }: { status: StudentStatus }) {
  return <Badge variant={STUDENT_STATUS_VARIANT[status]}>{STUDENT_STATUS_LABELS[status]}</Badge>
}

const ATTENDANCE_VARIANT: Record<AttendanceStatus, BadgeVariant> = {
  PRESENT: 'outline',
  LATE: 'secondary',
  ABSENT: 'destructive',
  EXCUSED: 'secondary',
}

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  return <Badge variant={ATTENDANCE_VARIANT[status]}>{ATTENDANCE_STATUS_LABELS[status]}</Badge>
}

/**
 * 余额徽标。
 *
 * isLow 由服务端给（它才知道这个学生的 lowBalanceThreshold）。前端只在
 * 拿不到 isLow 的列表接口上退回默认阈值 4 —— 并且这只影响颜色，不影响任何判断。
 */
export function BalanceBadge({ balance, isLow }: { balance: number; isLow?: boolean }) {
  const low = isLow ?? balance <= 4
  return (
    <Badge variant={low ? 'destructive' : 'outline'} className="font-mono tabular-nums">
      {balance} 课时
    </Badge>
  )
}
