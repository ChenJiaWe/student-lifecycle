import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EnrollmentStatus,
  ParticipantSource,
  Prisma,
  SessionStatus,
  SessionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { OwnershipService } from '../auth/ownership.service';
import type { AuthUser } from '../auth/auth.decorators';
import {
  melbourneStartOfToday,
  melbourneWallClockToUtc,
  sessionEndsAt,
  upcomingWeekdayDates,
} from '../common/timezone.util';

/** 第一版固定生成未来 2 周的课次（见 DESIGN.md 假设 10：滚动补齐未实现） */
const GENERATE_WEEKS_AHEAD = 2;

export interface ClassGroupOption {
  id: string;
  courseName: string;
  teacherName: string;
  weekday: number;
  startTimeLocal: string;
  durationMin: number;
  capacity: number;
  enrolledCount: number;
  /** null = 可排；否则是不可排的原因 */
  blockedReason: string | null;
  /** 可排但需要提醒（如余额只够几周） */
  warning: string | null;
}

@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  /**
   * 规则 2：学生同一时段不能上两节课（含试听）。
   *
   * 锁的对象是 Student 行 —— "时段冲突"是这个学生的属性。
   * 锁 session 或 classGroup 是错的：两个并发事务会各自查到"无冲突"
   * 然后双双插入（幻读）。
   *
   * 为什么不上数据库约束：SessionParticipant 没有时间列，要上 exclusion
   * constraint 就得把 startsAt/endsAt 冗余过去并在改课时同步维护。
   * 10 小时预算内选择应用层 + 行锁，并在 DESIGN.md 写明这个权衡。
   */
  private async assertNoStudentTimeConflict(
    tx: Prisma.TransactionClient,
    studentId: string,
    candidates: { startsAt: Date; endsAt: Date }[],
  ): Promise<void> {
    // 行锁：序列化同一学生的排课操作
    await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${studentId} FOR UPDATE`;

    const existing = await tx.sessionParticipant.findMany({
      where: {
        studentId,
        session: { status: { not: SessionStatus.CANCELLED } },
      },
      select: {
        session: {
          select: {
            startsAt: true,
            endsAt: true,
            classGroup: { select: { course: { select: { name: true } } } },
          },
        },
      },
    });

    for (const cand of candidates) {
      // 半开区间重叠判定：[a,b) 与 [c,d) 重叠 ⟺ a < d && c < b
      // 相邻不算冲突：16:00-17:00 与 17:00-18:00 可以连着上
      const clash = existing.find(
        (e) => cand.startsAt < e.session.endsAt && e.session.startsAt < cand.endsAt,
      );

      if (clash) {
        const name = clash.session.classGroup?.course.name ?? '试听课';
        throw new ConflictException(`与已排课程「${name}」时间冲突`);
      }
    }
  }

  /** 规则 8：班级容量不可超。试听生也占容量（见 DESIGN.md 假设 4） */
  private async assertCapacity(
    tx: Prisma.TransactionClient,
    classGroupId: string,
    capacity: number,
  ): Promise<void> {
    const count = await tx.enrollment.count({
      where: { classGroupId, status: EnrollmentStatus.ACTIVE },
    });

    if (count >= capacity) {
      throw new ConflictException(`班级已满（${count}/${capacity}）`);
    }
  }

  /**
   * 把学生排进每周固定班：校验冲突与容量，然后生成未来课次。
   *
   * 整个操作在一个事务里 —— 校验与写入之间不能有时间窗。
   */
  async enrollStudent(
    user: AuthUser,
    input: { studentId: string; classGroupId: string; startDate?: Date },
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 规则 7：只能操作自己名下的学生（在事务内校验）
      await this.ownership.assertCanMutateStudent(user, input.studentId, tx);

      const group = await tx.classGroup.findUnique({
        where: { id: input.classGroupId },
        include: { course: true, teacher: true },
      });

      if (!group || !group.active) {
        throw new NotFoundException('班级不存在或已停用');
      }

      const dup = await tx.enrollment.findUnique({
        where: {
          studentId_classGroupId: {
            studentId: input.studentId,
            classGroupId: input.classGroupId,
          },
        },
      });

      if (dup && dup.status === EnrollmentStatus.ACTIVE) {
        throw new ConflictException('该学生已在此班级');
      }

      await this.assertCapacity(tx, group.id, group.capacity);

      // 生成候选课次（墙钟时间 + 时区 → UTC，跨 DST 也正确）
      const anchor = input.startDate ?? melbourneStartOfToday();
      const dates = upcomingWeekdayDates(anchor, group.weekday, GENERATE_WEEKS_AHEAD);

      const candidates = dates.map((d) => {
        const startsAt = melbourneWallClockToUtc(d, group.startTimeLocal);
        return { startsAt, endsAt: sessionEndsAt(startsAt, group.durationMin) };
      });

      await this.assertNoStudentTimeConflict(tx, input.studentId, candidates);

      const enrollment = await tx.enrollment.upsert({
        where: {
          studentId_classGroupId: {
            studentId: input.studentId,
            classGroupId: input.classGroupId,
          },
        },
        update: { status: EnrollmentStatus.ACTIVE, endDate: null },
        create: {
          studentId: input.studentId,
          classGroupId: input.classGroupId,
          status: EnrollmentStatus.ACTIVE,
          startDate: anchor,
        },
      });

      /**
       * 课次可能已由同班其他学生的排课创建过 —— 复用而非重复创建。
       *
       * 这里刻意批量查/批量写，而不是在循环里逐条 findFirst + create：
       * Neon 是远程数据库，每次往返约 40ms，循环 N 节课就是 3N 次往返，
       * 很容易超过 Prisma 交互式事务的 5 秒默认超时（实测就是这么炸的）。
       */
      const existing = await tx.classSession.findMany({
        where: {
          classGroupId: group.id,
          startsAt: { in: candidates.map((c) => c.startsAt) },
        },
        select: { id: true, startsAt: true },
      });

      const existingByTime = new Map(existing.map((s) => [s.startsAt.getTime(), s.id]));
      const missing = candidates.filter((c) => !existingByTime.has(c.startsAt.getTime()));

      if (missing.length > 0) {
        await tx.classSession.createMany({
          data: missing.map((c) => ({
            classGroupId: group.id,
            teacherId: group.teacherId,
            type: SessionType.REGULAR,
            startsAt: c.startsAt,
            endsAt: c.endsAt,
            room: group.room,
          })),
        });

        const created = await tx.classSession.findMany({
          where: {
            classGroupId: group.id,
            startsAt: { in: missing.map((c) => c.startsAt) },
          },
          select: { id: true, startsAt: true },
        });
        for (const s of created) existingByTime.set(s.startsAt.getTime(), s.id);
      }

      // 幂等：撞 (sessionId, studentId) 唯一约束的记录直接跳过
      await tx.sessionParticipant.createMany({
        data: candidates.map((c) => ({
          sessionId: existingByTime.get(c.startsAt.getTime())!,
          studentId: input.studentId,
          source: ParticipantSource.ENROLLMENT,
        })),
        skipDuplicates: true,
      });

      return {
        enrollmentId: enrollment.id,
        className: group.course.name,
        sessionsCreated: missing.length,
        sessionsTotal: candidates.length,
      };
    },
    // 远程数据库 + 多次往返，5 秒默认超时不够
    { timeout: 20000 },
    );
  }

  /**
   * 排课抽屉的数据源：列出候选班级并标注每个为什么可排/不可排。
   *
   * 三种拦截理由在界面上区分表达（冲突 / 满员 / 余额不足），
   * 而不是统一灰掉按钮 —— 但服务端会在 enrollStudent 里再校验一遍。
   * 前端说人话，服务端做把关。
   */
  async listOptionsForStudent(user: AuthUser, studentId: string): Promise<ClassGroupOption[]> {
    await this.ownership.assertCanReadStudent(user, studentId);

    const [groups, participants, account] = await Promise.all([
      this.prisma.classGroup.findMany({
        where: { active: true },
        include: {
          course: true,
          teacher: true,
          _count: { select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } } },
        },
        orderBy: [{ weekday: 'asc' }, { startTimeLocal: 'asc' }],
      }),
      this.prisma.sessionParticipant.findMany({
        where: { studentId, session: { status: { not: SessionStatus.CANCELLED } } },
        select: {
          session: {
            select: {
              startsAt: true,
              endsAt: true,
              classGroupId: true,
              classGroup: { select: { course: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.creditAccount.findUnique({ where: { studentId } }),
    ]);

    const balance = account?.balance ?? 0;
    const anchor = melbourneStartOfToday();

    return groups.map((g) => {
      const enrolledCount = g._count.enrollments;

      const candidates = upcomingWeekdayDates(anchor, g.weekday, GENERATE_WEEKS_AHEAD).map((d) => {
        const startsAt = melbourneWallClockToUtc(d, g.startTimeLocal);
        return { startsAt, endsAt: sessionEndsAt(startsAt, g.durationMin) };
      });

      const alreadyIn = participants.some((p) => p.session.classGroupId === g.id);

      const clash = participants.find(
        (p) =>
          p.session.classGroupId !== g.id &&
          candidates.some(
            (c) => c.startsAt < p.session.endsAt && p.session.startsAt < c.endsAt,
          ),
      );

      let blockedReason: string | null = null;
      if (alreadyIn) blockedReason = '已在此班级';
      else if (enrolledCount >= g.capacity) blockedReason = '已满员';
      else if (clash) {
        blockedReason = `与「${clash.session.classGroup?.course.name ?? '试听课'}」时间冲突`;
      }

      let warning: string | null = null;
      if (!blockedReason && balance <= 0) warning = '课时余额为 0，需先购买课时';
      else if (!blockedReason && balance <= 4) warning = `剩余课时仅够 ${balance} 周`;

      return {
        id: g.id,
        courseName: g.course.name,
        teacherName: g.teacher.name,
        weekday: g.weekday,
        startTimeLocal: g.startTimeLocal,
        durationMin: g.durationMin,
        capacity: g.capacity,
        enrolledCount,
        blockedReason,
        warning,
      };
    });
  }

  /**
   * 安排试听课。
   *
   * 试听与正式课共用 ClassSession，只用 type 区分 —— 时空调度层同构，
   * 只在计费（不扣课时）和后续动作（必须标结果）上分叉。
   * 所以这里复用同一套冲突检测，"一学生仅一次试听"由数据库
   * partial unique index 兜底（规则 5）。
   */
  async scheduleTrial(
    user: AuthUser,
    input: { studentId: string; teacherId: string; startsAt: Date; durationMin: number; room?: string },
  ) {
    if (input.durationMin <= 0 || input.durationMin > 300) {
      throw new BadRequestException('课程时长应在 1–300 分钟之间');
    }

    const endsAt = sessionEndsAt(input.startsAt, input.durationMin);

    return this.prisma.$transaction(async (tx) => {
      await this.ownership.assertCanMutateStudent(user, input.studentId, tx);

      const teacher = await tx.teacher.findUnique({ where: { id: input.teacherId } });
      if (!teacher || !teacher.active) {
        throw new NotFoundException('老师不存在或已停用');
      }

      await this.assertNoStudentTimeConflict(tx, input.studentId, [
        { startsAt: input.startsAt, endsAt },
      ]);

      // 老师时段冲突由数据库 EXCLUDE 约束拦截，违反时抛 P2010/原始错误，
      // 由 PrismaExceptionFilter 翻译成 409
      const session = await tx.classSession.create({
        data: {
          classGroupId: null, // 1:1 试听不属于任何固定班
          teacherId: input.teacherId,
          type: SessionType.TRIAL,
          startsAt: input.startsAt,
          endsAt,
          room: input.room,
        },
      });

      // 一学生仅一次试听：撞 one_trial_per_student 索引 → 409
      await tx.sessionParticipant.create({
        data: {
          sessionId: session.id,
          studentId: input.studentId,
          source: ParticipantSource.TRIAL,
        },
      });

      await tx.student.update({
        where: { id: input.studentId },
        data: { status: 'TRIAL_SCHEDULED' },
      });

      return { sessionId: session.id, startsAt: session.startsAt, endsAt: session.endsAt };
    }, { timeout: 20000 });
  }

  /**
   * admin 工作台的试听列表。
   *
   * 把散落在 SessionParticipant 里的试听课次聚合成一个视图，让 admin 知道：
   * - 谁的试听排了但还没来（TRIAL_SCHEDULED）
   * - 谁来了但还没跟进（TRIAL_ATTENDED）
   *
   * 只返回自己名下的学生，与其他端点一致。
   */
  async listTrials(user: AuthUser) {
    const today = melbourneStartOfToday();

    const participants = await this.prisma.sessionParticipant.findMany({
      where: {
        source: ParticipantSource.TRIAL,
        student: { ownerAdminId: user.id },
      },
      orderBy: { session: { startsAt: 'desc' } },
      select: {
        studentId: true,
        student: {
          select: {
            id: true,
            name: true,
            grade: true,
            status: true,
            guardians: {
              where: { isPrimaryContact: true },
              select: {
                guardian: { select: { name: true, phone: true, wechat: true } },
                relation: true,
              },
              take: 1,
            },
          },
        },
        session: {
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            room: true,
            teacher: { select: { name: true } },
            attendance: {
              where: { studentId: undefined }, // 所有出勤，在 JS 侧过滤
              select: { studentId: true, status: true, teacherNote: true },
            },
          },
        },
      },
    });

    return participants.map((p) => {
      const att = p.session.attendance.find((a) => a.studentId === p.studentId);
      const contact = p.student.guardians[0];
      const isPast = new Date(p.session.startsAt) < today;

      return {
        studentId: p.student.id,
        studentName: p.student.name,
        grade: p.student.grade,
        studentStatus: p.student.status,
        sessionId: p.session.id,
        startsAt: p.session.startsAt,
        endsAt: p.session.endsAt,
        room: p.session.room,
        teacherName: p.session.teacher.name,
        attended: att != null,
        attendanceStatus: att?.status ?? null,
        teacherNote: att?.teacherNote ?? null,
        isPast,
        primaryContact: contact
          ? { name: contact.guardian.name, phone: contact.guardian.phone, wechat: contact.guardian.wechat, relation: contact.relation }
          : null,
      };
    });
  }

  /**
   * 课次滚动补齐：为所有活跃 Enrollment 生成未来 weeksAhead 周内尚缺的课次。
   *
   * 设计意图：enrollStudent 只在入学时生成 GENERATE_WEEKS_AHEAD(=2) 周的课次，
   * 之后靠本方法定期补。每次调用是幂等的——已有课次不重复建。
   *
   * 生产用法：由 NestJS Cron 每周一凌晨 2 时（墨尔本）调用（见 scheduling.module.ts）。
   * 也可以通过 POST /sessions/extend-upcoming 手动触发（供 admin 在部署后立即补全）。
   */
  async extendUpcomingSessions(weeksAhead = 4) {
    const today = melbourneStartOfToday();
    const cutoff = new Date(today.getTime() + weeksAhead * 7 * 86400000);

    const enrollments = await this.prisma.enrollment.findMany({
      where: { status: EnrollmentStatus.ACTIVE },
      select: {
        classGroupId: true,
        classGroup: {
          select: {
            id: true,
            weekday: true,
            startTimeLocal: true,
            durationMin: true,
            teacherId: true,
            startDate: true,
          },
        },
      },
    });

    // 唯一班级列表（多个学生同班只处理一次）
    const groups = [
      ...new Map(enrollments.map((e) => [e.classGroupId, e.classGroup])).values(),
    ];

    let created = 0;
    for (const g of groups) {
      const anchor = g.startDate > today ? g.startDate : today;
      const dates = upcomingWeekdayDates(anchor, g.weekday, weeksAhead);

      for (const date of dates) {
        const startsAt = melbourneWallClockToUtc(date, g.startTimeLocal);
        if (startsAt >= cutoff) continue;

        const exists = await this.prisma.classSession.findFirst({
          where: { classGroupId: g.id, startsAt },
          select: { id: true },
        });
        if (exists) continue;

        const endsAt = sessionEndsAt(startsAt, g.durationMin);
        await this.prisma.classSession.create({
          data: {
            classGroupId: g.id,
            teacherId: g.teacherId,
            type: SessionType.REGULAR,
            startsAt,
            endsAt,
          },
        });
        created++;
      }
    }

    return { groupsChecked: groups.length, sessionsCreated: created, cutoff };
  }
}
