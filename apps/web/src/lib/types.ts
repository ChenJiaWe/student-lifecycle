/**
 * 后端契约的镜像。枚举值与 apps/api/prisma/schema.prisma 一一对应；
 * 所有时间字段都是 UTC ISO 串（后端 JSON 序列化 Date 的结果）。
 */

export type Role = 'ADMIN' | 'TEACHER'

export type SessionType = 'REGULAR' | 'TRIAL' | 'MAKEUP'

export type SessionStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'

export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED'

export type TaskType = 'TRIAL_FOLLOWUP' | 'LOW_BALANCE' | 'ABSENCE_RISK' | 'FEEDBACK_RISK'

/** GET /api/auth/me —— 故意不含 passwordHash */
export interface AuthUser {
  id: string
  email: string
  name: string
  role: Role
  teacherId: string | null
}

/** POST /api/auth/login */
export interface LoginResponse {
  accessToken: string
  user: AuthUser
}

/** GET /api/teacher/today 的一项 */
export interface TeacherSession {
  id: string
  type: SessionType
  courseName: string
  startsAt: string
  endsAt: string
  room: string | null
  studentCount: number
  attendanceTaken: boolean
}

/** GET /api/sessions/:id/roster 的 session 部分 */
export interface RosterSession {
  id: string
  type: SessionType
  status: SessionStatus
  courseName: string
  startsAt: string
  endsAt: string
  room: string | null
  attendanceTaken: boolean
}

export interface RosterEntry {
  studentId: string
  name: string
  /** 试听生：不扣课时 */
  isTrial: boolean
  /** 第一次上这个班的课 */
  isFirstSession: boolean
  /**
   * 课时将尽 —— 只有布尔值，没有具体数字。
   * 老师需要的信号是"提醒学生找顾问续费"，余额属于 admin 的权限范围。
   */
  lowBalance: boolean
  attendance: { status: AttendanceStatus; teacherNote: string | null } | null
}

export interface RosterResponse {
  session: RosterSession
  roster: RosterEntry[]
}

/** POST /api/sessions/:id/attendance 的请求体 */
export interface AttendanceSubmission {
  records: Array<{
    studentId: string
    status: AttendanceStatus
    teacherNote?: string
  }>
}

/** POST /api/sessions/:id/attendance 的返回 */
export interface AttendanceResult {
  sessionId: string
  recorded: number
  results: Array<{
    studentId: string
    status: AttendanceStatus
    creditDeducted: boolean
    balanceAfter: number
  }>
  tasksOpened: TaskType[]
}
