import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AttendanceStatus,
  Prisma,
  Role,
  SessionStatus,
  SessionType,
  TaskType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { CreditsService } from '../credits/credits.service';
import { TasksService } from '../tasks/tasks.service';
import type { AuthUser } from '../auth/auth.decorators';
import { melbourneDayRange, melbourneStartOfToday } from '../common/timezone.util';

/** 哪些出勤状态要扣课时（见 DESIGN.md 假设 3） */
const CONSUMES_CREDIT: Record<AttendanceStatus, boolean> = {
  PRESENT: true,
  LATE: true,
  // 无故缺勤照扣 —— 老师的时间已经占用了，课时是钱
  ABSENT: true,
  // 提前请假不扣
  EXCUSED: false,
};

export interface RosterEntry {
  studentId: string;
  name: string;
  /** 试听生 */
  isTrial: boolean;
  /** 首次上这个班的课 —— 直击"老师不知道今天班里谁是新来的" */
  isFirstSession: boolean;
  /**
   * 课时将尽（布尔而非具体数字）。
   * 老师需要的是"该提醒学生带家长联系顾问"这个信号，
   * 不需要知道家长交了多少钱 —— 课时是钱，权限要分层。
   */
  lowBalance: boolean;
  attendance: { status: AttendanceStatus; teacherNote: string | null } | null;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    private readonly tasks: TasksService,
  ) {}

  /** 老师今日课程：登录后第一眼看到的东西 */
  async teacherToday(user: AuthUser, day?: Date) {
    if (user.role !== Role.TEACHER || !user.teacherId) {
      throw new ForbiddenException('仅老师可访问');
    }

    const { start, end } = melbourneDayRange(day ?? melbourneStartOfToday());

    const sessions = await this.prisma.classSession.findMany({
      where: {
        teacherId: user.teacherId,
        startsAt: { gte: start, lt: end },
        status: { not: SessionStatus.CANCELLED },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        type: true,
        startsAt: true,
        endsAt: true,
        room: true,
        classGroup: { select: { course: { select: { name: true } } } },
        _count: { select: { participants: true, attendance: true } },
      },
    });

    return sessions.map((s) => ({
      id: s.id,
      type: s.type,
      courseName: s.classGroup?.course.name ?? '试听课',
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      room: s.room,
      studentCount: s._count.participants,
      // 已点名 = 出勤记录数等于参与人数
      attendanceTaken: s._count.attendance > 0 && s._count.attendance >= s._count.participants,
    }));
  }

  /** 名单：三个标签（试听生 / 首次 / 课时将尽）解决老师的信息缺口 */
  async roster(user: AuthUser, sessionId: string): Promise<{ session: unknown; roster: RosterEntry[] }> {
    const session = await this.prisma.classSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        type: true,
        status: true,
        startsAt: true,
        endsAt: true,
        room: true,
        teacherId: true,
        classGroupId: true,
        classGroup: { select: { course: { select: { name: true } } } },
      },
    });

    if (!session) throw new NotFoundException('课次不存在');

    // 老师只能看自己的课
    if (user.role === Role.TEACHER && session.teacherId !== user.teacherId) {
      throw new ForbiddenException('只能查看自己的课程');
    }

    const participants = await this.prisma.sessionParticipant.findMany({
      where: { sessionId },
      select: {
        studentId: true,
        source: true,
        student: {
          select: {
            name: true,
            account: { select: { balance: true, lowBalanceThreshold: true } },
          },
        },
      },
    });

    const attendance = await this.prisma.attendance.findMany({
      where: { sessionId },
      select: { studentId: true, status: true, teacherNote: true },
    });
    const attMap = new Map(attendance.map((a) => [a.studentId, a]));

    // 首次上课判定：这个学生在这个班有没有更早的出勤记录
    const priorCounts = await this.prisma.attendance.groupBy({
      by: ['studentId'],
      where: {
        studentId: { in: participants.map((p) => p.studentId) },
        session: session.classGroupId
          ? { classGroupId: session.classGroupId, startsAt: { lt: session.startsAt } }
          : { startsAt: { lt: session.startsAt } },
      },
      _count: { _all: true },
    });
    const priorMap = new Map(priorCounts.map((p) => [p.studentId, p._count._all]));

    const roster: RosterEntry[] = participants.map((p) => {
      const balance = p.student.account?.balance ?? 0;
      const threshold = p.student.account?.lowBalanceThreshold ?? 4;
      const att = attMap.get(p.studentId);

      return {
        studentId: p.studentId,
        name: p.student.name,
        isTrial: p.source === 'TRIAL',
        isFirstSession: (priorMap.get(p.studentId) ?? 0) === 0,
        // 试听生不扣课时，所以不提示余额
        lowBalance: p.source !== 'TRIAL' && balance <= threshold,
        attendance: att ? { status: att.status, teacherNote: att.teacherNote } : null,
      };
    });

    return {
      session: {
        id: session.id,
        type: session.type,
        status: session.status,
        courseName: session.classGroup?.course.name ?? '试听课',
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        room: session.room,
        attendanceTaken: attendance.length > 0,
      },
      roster,
    };
  }

  /**
   * 提交点名 —— 整个切片最核心的操作。
   *
   * 一个事务内完成四件事：
   *   ① 写 Attendance（唯一约束保证幂等）
   *   ② 扣课时（幂等键 + 行锁 + CHECK 约束三重保障）
   *   ③ 触发跟进任务（低余额 / 试听跟进 / 连续缺勤）
   *   ④ 标记课次完成
   *
   * 规则 9：出勤只能在课次开始后记
   * 规则 10：出勤一经提交即锁定，老师不能修改
   */
  async submit(
    user: AuthUser,
    sessionId: string,
    records: { studentId: string; status: AttendanceStatus; teacherNote?: string }[],
  ) {
    if (records.length === 0) {
      throw new BadRequestException('至少需要一条出勤记录');
    }

    const dupes = records.length - new Set(records.map((r) => r.studentId)).size;
    if (dupes > 0) {
      throw new BadRequestException('同一学生出现多条出勤记录');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const session = await tx.classSession.findUnique({
          where: { id: sessionId },
          select: {
            id: true,
            type: true,
            status: true,
            startsAt: true,
            teacherId: true,
            participants: { select: { studentId: true, source: true } },
          },
        });

        if (!session) throw new NotFoundException('课次不存在');

        if (user.role === Role.TEACHER && session.teacherId !== user.teacherId) {
          throw new ForbiddenException('只能为自己的课程点名');
        }

        if (session.status === SessionStatus.CANCELLED) {
          throw new UnprocessableEntityException('课次已取消，无法点名');
        }

        // 规则 9：不能给还没开始的课点名
        if (session.startsAt > new Date()) {
          throw new UnprocessableEntityException('课程尚未开始，无法点名');
        }

        // 只能给名单上的学生点名
        const enrolled = new Set(session.participants.map((p) => p.studentId));
        const outsider = records.find((r) => !enrolled.has(r.studentId));
        if (outsider) {
          throw new BadRequestException(`学生 ${outsider.studentId} 不在本课次名单中`);
        }

        // 规则 10：出勤提交即锁定
        const existing = await tx.attendance.findMany({
          where: { sessionId, studentId: { in: records.map((r) => r.studentId) } },
          select: { studentId: true },
        });

        if (existing.length > 0) {
          throw new ConflictException(
            `已为 ${existing.length} 名学生点过名，出勤不可修改。如需订正请联系 admin`,
          );
        }

        const sourceMap = new Map(session.participants.map((p) => [p.studentId, p.source]));
        const results = [];
        const tasksOpened: TaskType[] = [];

        for (const rec of records) {
          const attendance = await tx.attendance.create({
            data: {
              sessionId,
              studentId: rec.studentId,
              status: rec.status,
              teacherNote: rec.teacherNote,
              recordedById: user.id,
            },
          });

          // 规则 6：试听不扣课时
          const isTrial = sourceMap.get(rec.studentId) === 'TRIAL';
          const shouldConsume = !isTrial && CONSUMES_CREDIT[rec.status];

          let balance = 0;
          let deducted = false;

          if (shouldConsume) {
            const r = await this.credits.consumeInTx(tx, {
              studentId: rec.studentId,
              sessionId,
              attendanceId: attendance.id,
              operatorId: user.id,
            });
            balance = r.balance;
            deducted = r.deducted;
          } else {
            const acc = await tx.creditAccount.findUnique({
              where: { studentId: rec.studentId },
            });
            balance = acc?.balance ?? 0;
          }

          const opened = await this.tasks.evaluateAfterAttendance(tx, {
            studentId: rec.studentId,
            sessionId,
            sessionType: isTrial ? SessionType.TRIAL : session.type,
            status: rec.status,
            balanceAfter: balance,
          });
          tasksOpened.push(...opened);

          results.push({
            studentId: rec.studentId,
            status: rec.status,
            creditDeducted: deducted,
            balanceAfter: balance,
          });
        }

        await tx.classSession.update({
          where: { id: sessionId },
          data: { status: SessionStatus.COMPLETED },
        });

        return {
          sessionId,
          recorded: results.length,
          results,
          tasksOpened: [...new Set(tasksOpened)],
        };
      },
      { timeout: 20000 },
    );
  }

  /**
   * 订正出勤（规则 11）。
   *
   * 只有 admin 能做，且必须填原因。做法是更新 Attendance.status +
   * 写一条反向 ledger —— 账本只能冲正不能删改。
   *
   * 破坏测试可测："反复改出勤能不能刷出课时？"
   * 答案：不能。reverse 有幂等键，第二次冲正直接返回既有状态。
   */
  async correct(
    user: AuthUser,
    sessionId: string,
    input: { studentId: string; status: AttendanceStatus; note: string },
  ) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('只有 admin 能订正出勤');
    }

    if (!input.note?.trim()) {
      throw new UnprocessableEntityException('订正出勤必须填写原因');
    }

    return this.prisma.$transaction(async (tx) => {
      const attendance = await tx.attendance.findUnique({
        where: { sessionId_studentId: { sessionId, studentId: input.studentId } },
        select: { id: true, status: true },
      });

      if (!attendance) throw new NotFoundException('该学生没有此课次的出勤记录');

      if (attendance.status === input.status) {
        throw new BadRequestException('出勤状态未发生变化');
      }

      const wasConsuming = CONSUMES_CREDIT[attendance.status];
      const nowConsuming = CONSUMES_CREDIT[input.status];

      let balance: number | null = null;

      // 从扣费状态改成不扣费 → 冲正
      if (wasConsuming && !nowConsuming) {
        const r = await this.credits.reverseConsumeInTx(tx, {
          studentId: input.studentId,
          sessionId,
          attendanceId: attendance.id,
          operatorId: user.id,
          note: input.note,
        });
        balance = r.balance;
      }

      // 从不扣费改成扣费 → 补扣
      if (!wasConsuming && nowConsuming) {
        const r = await this.credits.consumeInTx(tx, {
          studentId: input.studentId,
          sessionId,
          attendanceId: attendance.id,
          operatorId: user.id,
          note: `出勤订正补扣: ${input.note}`,
        });
        balance = r.balance;
      }

      const updated = await tx.attendance.update({
        where: { id: attendance.id },
        data: {
          status: input.status,
          correctedById: user.id,
          correctedAt: new Date(),
          correctionNote: input.note,
        },
        select: { studentId: true, status: true, correctionNote: true },
      });

      return { ...updated, previousStatus: attendance.status, balance };
    });
  }
}
