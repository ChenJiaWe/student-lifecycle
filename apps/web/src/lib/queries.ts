import { queryOptions } from '@tanstack/react-query'
import { api } from './api'
import type {
  AttendanceResult,
  AttendanceStatus,
  AttendanceSubmission,
  AuthUser,
  LoginResponse,
  RosterResponse,
  SessionType,
  TaskType,
  TeacherSession,
} from './types'

/**
 * queryOptions 是 loader 和组件之间的唯一契约：
 * loader 里 `ensureQueryData(x)` 预取，组件里 `useQuery(x)` 读同一份缓存。
 * 两边共用一个对象，key 不可能写歪。
 */

export const meQueryOptions = queryOptions({
  queryKey: ['auth', 'me'] as const,
  queryFn: () => api<AuthUser>('/auth/me'),
  // 登录状态不会自己变，5 分钟内不重新问
  staleTime: 5 * 60_000,
})

export const teacherTodayQueryOptions = queryOptions({
  queryKey: ['teacher', 'today'] as const,
  queryFn: () => api<TeacherSession[]>('/teacher/today'),
  // 点完名回到首页要看到状态已更新，所以窗口开得短
  staleTime: 15_000,
})

export const rosterQueryOptions = (sessionId: string) =>
  queryOptions({
    queryKey: ['sessions', sessionId, 'roster'] as const,
    // 名单是点名的依据，且"是否已点名"会被别人改变，每次进页面都取最新
    staleTime: 0,
    queryFn: () => api<RosterResponse>(`/sessions/${sessionId}/roster`),
  })

export function login(email: string, password: string) {
  return api<LoginResponse>('/auth/login', {
    method: 'POST',
    json: { email, password },
  })
}

export function logout() {
  return api<{ ok: true }>('/auth/logout', { method: 'POST' })
}

export function submitAttendance(sessionId: string, body: AttendanceSubmission) {
  return api<AttendanceResult>(`/sessions/${sessionId}/attendance`, {
    method: 'POST',
    json: body,
  })
}

/* ══════════════════════════════════════════════════════════════════════
 * admin 侧：工作台 / 学生列表 / 学生详情 / 排课
 * ════════════════════════════════════════════════════════════════════ */

/** schema.prisma 的 StudentStatus */
export type StudentStatus =
  | 'INQUIRY'
  | 'TRIAL_SCHEDULED'
  | 'TRIAL_ATTENDED'
  | 'ENROLLED'
  | 'AT_RISK'
  | 'CHURNED'
  | 'LOST'

export type TaskCreator = 'SYSTEM' | 'USER'

/** schema.prisma 的 LedgerReason。EXPIRE 第一版不产生，但枚举里有 */
export type LedgerReason = 'PURCHASE' | 'CONSUME' | 'REFUND' | 'EXPIRE' | 'ADJUST'

export interface PrimaryContact {
  name: string
  phone: string | null
  relation: string
}

/**
 * GET /api/tasks 的一条任务。
 *
 * 带足够的上下文让 admin 不进详情页也能打这个电话：主联系人、下次课、
 * 余额。工作台的价值就在这 —— 少一次跳转就多处理一个学生。
 */
export interface WorkbenchTask {
  id: string
  type: TaskType
  reason: string
  dueAt: string
  /** 服务端算的逾期天数，> 0 就要显著标出 */
  overdueDays: number
  createdBy: TaskCreator
  isMine: boolean
  ownerName: string
  student: {
    id: string
    name: string
    grade: string | null
    status: StudentStatus
    balance: number
    primaryContact: PrimaryContact | null
  }
  nextSession: { startsAt: string; courseName: string } | null
}

export interface TaskGroup {
  type: TaskType
  label: string
  items: WorkbenchTask[]
}

/** groups 里只有非空分组 —— 服务端已经 filter 过了 */
export interface TaskFeed {
  total: number
  overdue: number
  groups: TaskGroup[]
}

export interface TaskOverview {
  studentCount: number
  openTasks: number
  weekSessions: number
  pendingTrials: number
}

/** GET /api/students 的一行 */
export interface StudentListRow {
  id: string
  name: string
  status: StudentStatus
  ownerAdminId: string
  ownerAdmin: { name: string } | null
  account: { balance: number } | null
  /** 服务端标的归属，前端据此决定是否显示编辑入口（体验层，非把关） */
  isMine: boolean
}

export interface GuardianLink {
  relation: string
  isPrimaryContact: boolean
  isPayer: boolean
  guardian: {
    id: string
    name: string
    phone: string | null
    email: string | null
    wechat: string | null
  }
}

export interface EnrollmentRow {
  id: string
  startDate: string
  classGroup: {
    id: string
    weekday: number
    startTimeLocal: string
    durationMin: number
    room: string | null
    course: { name: string; subject: string | null }
    teacher: { name: string }
  } | null
}

export interface AttendanceRow {
  id: string
  status: AttendanceStatus
  teacherNote: string | null
  recordedAt: string
  /** 非 null 表示这条出勤被 admin 订正过，界面上要标出来 */
  correctedAt: string | null
  correctionNote: string | null
  session: {
    id: string
    type: SessionType
    startsAt: string
    classGroup: { course: { name: string } } | null
  }
  recordedBy: { name: string } | null
}

export interface StudentTask {
  id: string
  type: TaskType
  reason: string
  dueAt: string
  createdBy: TaskCreator
}

export interface LedgerEntry {
  id: string
  delta: number
  reason: LedgerReason
  note: string | null
  createdAt: string
  createdBy: { name: string } | null
  purchase: { amountCents: number } | null
  sessionId: string | null
}

/**
 * 课时区对老师是降级的（只有 isLow，没有余额和流水）——
 * 见 students.controller 的 detail。这个页面只给 admin，但类型上保留
 * 可选性，免得误当成一定有。
 */
export interface CreditsBlock {
  balance?: number
  lowBalanceThreshold?: number
  isLow: boolean
  ledger?: LedgerEntry[]
}

/** GET /api/students/:id —— 一页看全，前端不用打五个接口再自己拼 */
export interface StudentDetail {
  id: string
  name: string
  grade: string | null
  status: StudentStatus
  note: string | null
  source: string | null
  createdAt: string
  isMine: boolean
  ownerAdmin: { id: string; name: string }
  account: { balance: number; lowBalanceThreshold: number } | null
  guardians: GuardianLink[]
  enrollments: EnrollmentRow[]
  attendance: AttendanceRow[]
  tasks: StudentTask[]
  credits: CreditsBlock
  attendanceStats: {
    total: number
    present: number
    late: number
    absent: number
    excused: number
  }
}

/** GET /api/students/:id/class-options 的一个候选班 */
export interface ClassOption {
  id: string
  courseName: string
  teacherName: string
  weekday: number
  startTimeLocal: string
  durationMin: number
  capacity: number
  enrolledCount: number
  /** null = 可排；否则是不可排的原因（已在此班级 / 已满员 / 与「X」时间冲突） */
  blockedReason: string | null
  /** 可排但要提醒（如课时只够几周） */
  warning: string | null
}

export interface EnrollResult {
  enrollmentId: string
  className: string
  sessionsCreated: number
  sessionsTotal: number
}

/** GET /api/students/:id/digest/fallback —— 简报的降级内容，页面加载即取 */
export interface DigestFallback {
  timeline: Array<{
    date: string
    status: AttendanceStatus
    note: string | null
    courseName: string
    teacherName: string
  }>
  stats: { total: number; present: number; late: number; absent: number; excused: number }
}

/** 刻意没有任何数字字段 —— 课时、金额、出勤率一律由数据库渲染，不让 LLM 碰钱 */
export interface Digest {
  progress_summary: string
  strengths: string[]
  concerns: string[]
  risk_level: 'low' | 'medium' | 'high'
  parent_message_draft: string
  talking_points: string[]
}

export type DigestResult =
  | { available: true; digest: Digest; model: string; cached: boolean; generatedAt: string }
  /** 降级：简报不可用，但续费流程完全不受影响 */
  | { available: false; reason: string }

export type TaskScope = 'mine' | 'all'

/**
 * 工作台的待跟进列表。
 *
 * staleTime 开得短：任务是共享状态，同事刚处理掉一条时不该还挂在这儿。
 */
export const taskFeedQueryOptions = (scope: TaskScope) =>
  queryOptions({
    queryKey: ['tasks', 'feed', scope] as const,
    queryFn: () => api<TaskFeed>(`/tasks?scope=${scope}`),
    staleTime: 15_000,
  })

export const taskOverviewQueryOptions = queryOptions({
  queryKey: ['tasks', 'overview'] as const,
  queryFn: () => api<TaskOverview>('/tasks/overview'),
  staleTime: 60_000,
})

export const studentsQueryOptions = queryOptions({
  queryKey: ['students', 'list'] as const,
  queryFn: () => api<StudentListRow[]>('/students'),
  staleTime: 30_000,
})

export const studentDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['students', 'detail', id] as const,
    queryFn: () => api<StudentDetail>(`/students/${id}`),
  })

/**
 * 排课抽屉的候选班级。
 *
 * 不缓存：容量是共享状态，同事刚把最后一个位置占掉时不该还显示"可排"。
 * 真正的把关在服务端 enroll，这里只是少一次误导。
 */
export const classOptionsQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['students', 'class-options', id] as const,
    queryFn: () => api<ClassOption[]>(`/students/${id}/class-options`),
    staleTime: 0,
  })

export const digestFallbackQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['students', 'digest-fallback', id] as const,
    queryFn: () => api<DigestFallback>(`/students/${id}/digest/fallback`),
  })

/* ── 写操作 ──────────────────────────────────────────────────────────── */

export function resolveTask(taskId: string, body: { status: 'DONE' | 'DISMISSED'; note?: string }) {
  return api<{ id: string; status: string; resolvedAt: string; resolutionNote: string | null }>(
    `/tasks/${taskId}/resolve`,
    { method: 'POST', json: body },
  )
}

export function enrollStudent(studentId: string, body: { classGroupId: string; startDate?: string }) {
  return api<EnrollResult>(`/students/${studentId}/enroll`, { method: 'POST', json: body })
}

/** amountCents 是整数分 —— 调用方负责换算，接口不接浮点 */
export function purchaseCredits(
  studentId: string,
  body: { credits: number; amountCents: number; note?: string },
) {
  return api<{ purchaseId: string; balance: number }>(`/students/${studentId}/credits/purchase`, {
    method: 'POST',
    json: body,
  })
}

/** 简报是 POST：只在 admin 主动点击时才调 LLM，控制成本 */
export function generateDigest(studentId: string) {
  return api<DigestResult>(`/students/${studentId}/digest`, { method: 'POST' })
}

/* ── 展示用的枚举文案 ─────────────────────────────────────────────────── */

export const STUDENT_STATUS_LABELS: Record<StudentStatus, string> = {
  INQUIRY: '咨询中',
  TRIAL_SCHEDULED: '待试听',
  TRIAL_ATTENDED: '试听已完成',
  ENROLLED: '在读',
  AT_RISK: '风险',
  CHURNED: '已流失',
  LOST: '已丢单',
}

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  TRIAL_FOLLOWUP: '试听待跟进',
  LOW_BALANCE: '课时将尽',
  ABSENCE_RISK: '连续缺勤',
  FEEDBACK_RISK: '反馈风险信号',
}

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: '到课',
  LATE: '迟到',
  ABSENT: '缺勤',
  EXCUSED: '请假',
}

export const LEDGER_REASON_LABELS: Record<LedgerReason, string> = {
  PURCHASE: '购买',
  CONSUME: '上课扣减',
  REFUND: '退款',
  EXPIRE: '过期',
  ADJUST: '人工调整',
}
