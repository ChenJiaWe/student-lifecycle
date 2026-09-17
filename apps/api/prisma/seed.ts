import {
  AttendanceStatus,
  ParticipantSource,
  PrismaClient,
  Role,
  SessionStatus,
  SessionType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { addDays, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import {
  BUSINESS_TZ,
  melbourneStartOfToday,
  melbourneWallClockToUtc,
  melbourneWeekday,
  sessionEndsAt,
} from '../src/common/timezone.util';

/**
 * seed 走直连而非 pooler。
 *
 * 原因：pooler（Supavisor/PgBouncer）是为"很多短连接"设计的，而 seed 是
 * 一次性批处理，几十个大批量写入会撑爆连接池并发限制抛 P2024。
 * 直连没有这个中间层，批处理更稳。
 * 运行时（NestJS）仍然走 pooler —— 那才是 pooler 的用武之地。
 */
const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL },
  },
});

/**
 * ⚠ 所有日期相对 seed 运行时的"今天"推算，绝不写死。
 *
 * 写死日期的后果：评审隔几天打开 /teacher/today 是空白页 —— 老师视角
 * 的 demo 当场报废，而那是切片的核心。
 *
 * 更隐蔽的子问题：如果评审在周六打开、而所有班都排在工作日，今日课程
 * 照样是空的。所以下面的班级 weekday 按运行日动态安排，
 * 保证"今天"一定有课（一节未点名、一节已点名，两种状态都能演示）。
 */

const PASSWORD = 'demo1234';

/**
 * Neon 免费档 compute 空闲 5 分钟就休眠，第一次连接会因唤醒超时抛 P1001。
 * 评审跑 `pnpm db:seed` 时会遇到同样的情况，所以这里主动重试而不是直接失败。
 */
async function waitForDatabase(attempts = 5): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      if (i > 1) console.log(`  数据库已唤醒（第 ${i} 次尝试）`);
      return;
    } catch (err) {
      const isColdStart =
        err instanceof Error && (err.message.includes('P1001') || err.message.includes("Can't reach"));

      if (!isColdStart || i === attempts) throw err;
      console.log(`  数据库休眠中，等待唤醒… (${i}/${attempts})`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function reset(): Promise<void> {
  // 顺序重要：先删依赖方
  await prisma.creditLedger.deleteMany();
  await prisma.creditPurchase.deleteMany();
  await prisma.followUpTask.deleteMany();
  await prisma.lessonDigest.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.sessionParticipant.deleteMany();
  await prisma.classSession.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.creditAccount.deleteMany();
  await prisma.studentGuardian.deleteMany();
  await prisma.guardian.deleteMany();
  await prisma.student.deleteMany();
  await prisma.classGroup.deleteMany();
  await prisma.course.deleteMany();
  await prisma.user.deleteMany();
  await prisma.teacher.deleteMany();
}

const FIRST_NAMES = ['小明', '小红', '子豪', '嘉怡', '雨涵', '浩然', '欣怡', '思远', '梦琪', '宇轩'];
const SURNAMES = ['李', '王', '张', '刘', '陈', '杨', '黄', '周', '吴', '徐'];

function studentName(i: number): string {
  return SURNAMES[i % SURNAMES.length] + FIRST_NAMES[(i * 3) % FIRST_NAMES.length];
}

async function main(): Promise<void> {
  await waitForDatabase();
  console.log('清理旧数据…');
  await reset();

  const hash = await bcrypt.hash(PASSWORD, 10);
  const today = melbourneStartOfToday();
  const todayWeekday = melbourneWeekday(today);

  // ── 老师：20 名 ──
  //
  // 用 createMany 而非 Promise.all 并发 create：Neon pooler 在 compute
  // 刚唤醒时并发连接容易打爆连接池抛 P1001。批量插入只占一个连接。
  console.log('创建老师与账号…');
  await prisma.teacher.createMany({
    data: Array.from({ length: 20 }, (_, i) => ({
      id: `tea-${String(i).padStart(2, '0')}`,
      name: `${SURNAMES[i % 10]}老师${i < 10 ? '' : '2'}`,
      subjects: i % 3 === 0 ? ['写作'] : i % 3 === 1 ? ['口语'] : ['阅读', '写作'],
    })),
  });
  const teachers = await prisma.teacher.findMany({ orderBy: { id: 'asc' } });

  // demo 老师（李老师）放在第一个，账号直接给评审用
  const demoTeacher = teachers[0];
  await prisma.user.create({
    data: {
      email: 'teacher@demo.local',
      passwordHash: hash,
      name: demoTeacher.name,
      role: Role.TEACHER,
      teacherId: demoTeacher.id,
    },
  });

  // 第二个老师账号：用于演示"只能看自己的课"
  await prisma.user.create({
    data: {
      email: 'teacher2@demo.local',
      passwordHash: hash,
      name: teachers[1].name,
      role: Role.TEACHER,
      teacherId: teachers[1].id,
    },
  });

  // ── admin：10 名，各管约 100 名学生（背景设定）──
  await prisma.user.createMany({
    data: Array.from({ length: 10 }, (_, i) => ({
      id: `adm-${String(i).padStart(2, '0')}`,
      email: i === 0 ? 'admin@demo.local' : `admin${i + 1}@demo.local`,
      passwordHash: hash,
      name: `${SURNAMES[i]}顾问`,
      role: Role.ADMIN,
    })),
  });
  const admins = await prisma.user.findMany({
    where: { role: Role.ADMIN },
    orderBy: { id: 'asc' },
  });
  const demoAdmin = admins[0];

  // ── 课程与班级 ──
  console.log('创建课程与班级…');
  await prisma.course.createMany({
    data: [
      { id: 'cou-0', name: 'IELTS 写作初级', subject: '写作', level: '初级' },
      { id: 'cou-1', name: 'IELTS 写作中级', subject: '写作', level: '中级' },
      { id: 'cou-2', name: 'IELTS 口语初级', subject: '口语', level: '初级' },
      { id: 'cou-3', name: 'IELTS 口语中级', subject: '口语', level: '中级' },
      { id: 'cou-4', name: 'IELTS 阅读提升', subject: '阅读', level: '中级' },
    ],
  });
  const courses = await prisma.course.findMany({ orderBy: { id: 'asc' } });

  /**
   * demo 老师今天的课时间要相对"当前时刻"安排，不能写死。
   *
   * 原因：规则 9 禁止给尚未开始的课点名。如果把今天的课固定排在 16:00，
   * 而评审上午打开系统，点名功能根本无法演示 —— 和"seed 写死日期"
   * 是同一类 demo 阻塞问题，只是粒度到了小时。
   *
   * 所以：一节安排在 2 小时前（已开始，可立即点名），
   * 一节安排在 2 小时后（未开始，用于演示规则 9 的拦截）。
   */
  const nowMel = toZonedTime(new Date(), BUSINESS_TZ);
  const hhmm = (h: number): string =>
    `${String(Math.max(6, Math.min(21, h))).padStart(2, '0')}:00`;
  const startedAt = hhmm(nowMel.getHours() - 2);
  const upcomingAt = hhmm(nowMel.getHours() + 2);

  // 15 个班：前 3 个强制排在"今天"，保证 demo 一定有课
  const groupSpecs = [
    // 已开始 → 可以立即演示点名
    { weekday: todayWeekday, startTimeLocal: startedAt, teacher: 0, course: 0, capacity: 8 },
    // 未开始 → 演示规则 9 的拦截
    { weekday: todayWeekday, startTimeLocal: upcomingAt, teacher: 0, course: 2, capacity: 6 },
    { weekday: todayWeekday, startTimeLocal: '10:00', teacher: 1, course: 1, capacity: 8 },
    // 后续班级分散在其他日子
    ...Array.from({ length: 12 }, (_, i) => ({
      weekday: (todayWeekday + 1 + (i % 6)) % 7,
      startTimeLocal: ['09:00', '11:00', '14:00', '16:00', '18:00'][i % 5],
      teacher: 2 + (i % 18),
      course: i % 5,
      capacity: [6, 8, 10][i % 3],
    })),
  ];

  await prisma.classGroup.createMany({
    data: groupSpecs.map((s, i) => ({
      id: `grp-${String(i).padStart(2, '0')}`,
      courseId: courses[s.course].id,
      teacherId: teachers[s.teacher].id,
      weekday: s.weekday,
      startTimeLocal: s.startTimeLocal,
      durationMin: 90,
      capacity: s.capacity,
      room: `${String.fromCharCode(65 + (s.teacher % 6))}教室`,
      startDate: subDays(today, 60),
    })),
  });
  const groups = await prisma.classGroup.findMany({ orderBy: { id: 'asc' } });

  // ── 学生：200 名，demo admin 名下 70+ ──
  //
  // 用 createMany 批量插入而不是循环 create：Neon 是远程数据库，
  // 每次往返约 40ms，200 次循环就是 8 秒 —— 而批量插入只要一次往返。
  // README 里让评审跑 `pnpm db:seed`，所以 seed 本身也要够快。
  console.log('创建学生与家长…');
  await prisma.student.createMany({
    data: Array.from({ length: 200 }, (_, i) => ({
      id: `stu-${String(i).padStart(3, '0')}`,
      name: studentName(i),
      grade: `${6 + (i % 7)}年级`,
      status: 'ENROLLED' as const,
      // 前 72 个归 demo admin，让"一个 admin 管很多学生"看得出来
      ownerAdminId: (i < 72 ? demoAdmin : admins[1 + (i % 9)]).id,
      source: ['转介绍', '线上咨询', '路过咨询', '老生续报'][i % 4],
      createdAt: subDays(today, 90 - (i % 90)),
    })),
  });

  const students = await prisma.student.findMany({ orderBy: { id: 'asc' } });

  // 家长：主联系人与付款人可以是不同的人（家长 ≠ 学生 ≠ 付款人）
  await prisma.guardian.createMany({
    data: students.flatMap((s, i) => [
      {
        id: `gua-m-${String(i).padStart(3, '0')}`,
        name: `${s.name[0]}太太`,
        phone: `04${String(10000000 + i).slice(0, 8)}`,
        wechat: `wx_${i}`,
      },
      // 每 5 个学生有父亲记录，演示"一个孩子两位家长"
      ...(i % 5 === 0
        ? [
            {
              id: `gua-f-${String(i).padStart(3, '0')}`,
              name: `${s.name[0]}先生`,
              phone: `04${String(20000000 + i).slice(0, 8)}`,
            },
          ]
        : []),
    ]),
  });

  await prisma.studentGuardian.createMany({
    data: students.flatMap((s, i) => [
      {
        studentId: s.id,
        guardianId: `gua-m-${String(i).padStart(3, '0')}`,
        relation: '母亲',
        isPrimaryContact: true,
        isPayer: true,
      },
      ...(i % 5 === 0
        ? [
            {
              studentId: s.id,
              guardianId: `gua-f-${String(i).padStart(3, '0')}`,
              relation: '父亲',
              isPrimaryContact: false,
              isPayer: false,
            },
          ]
        : []),
    ]),
  });

  // ── 课时账户：刻意埋出不同余额档位 ──
  console.log('创建课时账户与流水…');
  /**
   * 目标余额：每 10 人里安排 1 个低余额（触发续费任务）、1 个余额为 0。
   *
   * ⚠ 关键：balance 必须等于流水之和。
   * 如果直接设 balance 而流水对不上，评审一追问"你这 20 课时怎么用掉的"
   * 就会发现账目不平 —— 而"课时是钱、流水是真相"正是这个模型的卖点。
   * 所以下面先算出目标余额，再倒推购买量，让 purchase - consume = balance。
   */
  const targetBalance = (i: number): number =>
    i % 10 === 3 ? 2 : i % 10 === 7 ? 0 : 8 + (i % 12);

  // 购买记录先建，实际扣减在生成出勤时按每条 PRESENT/LATE/ABSENT 补 CONSUME 流水
  await prisma.creditPurchase.createMany({
    data: students.map((s, i) => ({
      id: `pur-${String(i).padStart(3, '0')}`,
      studentId: s.id,
      // 购买量 = 目标余额 + 将要消耗的课时数（消耗数在出勤阶段确定，
      // 这里先按最大可能值预留，出勤生成后再对账修正 balance）
      credits: targetBalance(i) + 12,
      amountCents: (targetBalance(i) + 12) * 24000,
      purchasedAt: subDays(today, 40 - (i % 30)),
      createdById: s.ownerAdminId,
    })),
  });

  await prisma.creditLedger.createMany({
    data: students.map((s, i) => ({
      studentId: s.id,
      delta: targetBalance(i) + 12,
      reason: 'PURCHASE' as const,
      purchaseId: `pur-${String(i).padStart(3, '0')}`,
      note: `购买 ${targetBalance(i) + 12} 课时`,
      createdById: s.ownerAdminId,
      createdAt: subDays(today, 40 - (i % 30)),
    })),
  });

  // 账户先按购买量入账，出勤生成后再扣减
  await prisma.creditAccount.createMany({
    data: students.map((s, i) => ({
      studentId: s.id,
      balance: targetBalance(i) + 12,
      lowBalanceThreshold: 4,
    })),
  });

  // ── 报名：把学生分到班里 ──
  console.log('创建报名关系…');
  await prisma.enrollment.createMany({
    data: groups.flatMap((group, gi) =>
      students
        .slice(gi * 6, gi * 6 + Math.min(group.capacity - 1, 5 + (gi % 3)))
        .map((s) => ({
          studentId: s.id,
          classGroupId: group.id,
          startDate: subDays(today, 50),
        })),
    ),
  });

  // ── 课次：过去 4 周 + 未来 2 周（全部相对今天）──
  console.log('生成课次与出勤历史…');

  const enrollmentsByGroup = new Map<string, string[]>();
  for (const e of await prisma.enrollment.findMany({
    where: { status: 'ACTIVE' },
    select: { classGroupId: true, studentId: true },
  })) {
    const list = enrollmentsByGroup.get(e.classGroupId) ?? [];
    list.push(e.studentId);
    enrollmentsByGroup.set(e.classGroupId, list);
  }

  // 预先取出每位老师对应的 User，避免在出勤循环里逐条查（N+1）
  const teacherUsers = new Map(
    (
      await prisma.user.findMany({
        where: { teacherId: { not: null } },
        select: { id: true, teacherId: true },
      })
    ).map((u) => [u.teacherId!, u.id]),
  );

  const NOTES = [
    '讲了 Task 2 结构，能套模板但论点展开偏薄',
    '作文有进步，开头段比之前清楚，词汇还是偏简单',
    '小组讨论比较沉默，写作练习完成度高',
    'Task 2 拿了 6 分，结构分提上来了，语法小错误多',
    '词汇练习认真，开始会用一些高级句式',
    '这次作文 6.5，进步明显；提到想考 7 分',
  ];

  type SessionRow = {
    id: string;
    classGroupId: string;
    teacherId: string;
    type: SessionType;
    startsAt: Date;
    endsAt: Date;
    room: string | null;
    status: SessionStatus;
  };

  const sessionRows: SessionRow[] = [];
  const participantRows: {
    sessionId: string;
    studentId: string;
    source: ParticipantSource;
  }[] = [];
  const attendanceRows: {
    sessionId: string;
    studentId: string;
    status: AttendanceStatus;
    teacherNote: string;
    recordedById: string;
    recordedAt: Date;
  }[] = [];

  let sid = 0;
  let pastSessions = 0;
  let todaySessions = 0;

  for (const group of groups) {
    const memberIds = enrollmentsByGroup.get(group.id) ?? [];
    if (memberIds.length === 0) continue;

    for (let offset = -28; offset <= 14; offset++) {
      const day = addDays(today, offset);
      if (melbourneWeekday(day) !== group.weekday) continue;

      // 墙钟时间 + 时区 → UTC，跨 DST 也正确
      const startsAt = melbourneWallClockToUtc(day, group.startTimeLocal);
      const endsAt = sessionEndsAt(startsAt, group.durationMin);
      const isPast = offset < 0;
      const sessionId = `ses-${String(sid++).padStart(4, '0')}`;

      sessionRows.push({
        id: sessionId,
        classGroupId: group.id,
        teacherId: group.teacherId,
        type: SessionType.REGULAR,
        startsAt,
        endsAt,
        room: group.room,
        status: isPast ? SessionStatus.COMPLETED : SessionStatus.SCHEDULED,
      });

      for (const studentId of memberIds) {
        participantRows.push({
          sessionId,
          studentId,
          source: ParticipantSource.ENROLLMENT,
        });
      }

      if (isPast) pastSessions++;
      if (offset === 0) todaySessions++;

      // 过去的课补出勤与反馈 —— 这些反馈是 LLM 简报的输入
      if (isPast) {
        const recorder = teacherUsers.get(group.teacherId) ?? demoAdmin.id;

        for (const [ei, studentId] of memberIds.entries()) {
          const roll = Math.abs(offset + ei) % 10;
          attendanceRows.push({
            sessionId,
            studentId,
            status:
              roll === 0
                ? AttendanceStatus.ABSENT
                : roll === 1
                  ? AttendanceStatus.LATE
                  : roll === 2
                    ? AttendanceStatus.EXCUSED
                    : AttendanceStatus.PRESENT,
            teacherNote: NOTES[Math.abs(offset + ei) % NOTES.length],
            recordedById: recorder,
            recordedAt: endsAt,
          });
        }
      }
    }
  }

  await prisma.classSession.createMany({ data: sessionRows });
  await prisma.sessionParticipant.createMany({ data: participantRows });
  await prisma.attendance.createMany({ data: attendanceRows });

  /**
   * 为历史出勤补 CONSUME 流水并对账。
   *
   * 这样 balance 严格等于流水之和 —— 评审追问"这些课时怎么用掉的"，
   * 学生详情页的流水时间线能逐条对上。EXCUSED（提前请假）不扣，
   * ABSENT（无故缺勤）照扣：老师的时间已经占用了（见 DESIGN.md 假设 3）。
   */
  console.log('补齐历史课时流水并对账…');
  const attendanceWithIds = await prisma.attendance.findMany({
    select: { id: true, sessionId: true, studentId: true, status: true, recordedAt: true },
  });

  const consumed = new Map<string, number>();
  const consumeLedger = attendanceWithIds
    .filter((a) => a.status !== AttendanceStatus.EXCUSED)
    .map((a) => {
      consumed.set(a.studentId, (consumed.get(a.studentId) ?? 0) + 1);
      const owner = students.find((s) => s.id === a.studentId)!.ownerAdminId;
      return {
        studentId: a.studentId,
        delta: -1,
        reason: 'CONSUME' as const,
        sessionId: a.sessionId,
        attendanceId: a.id,
        // 与运行时一致的幂等键，避免 demo 时重复扣
        idempotencyKey: `consume:${a.sessionId}:${a.studentId}`,
        note: a.status === AttendanceStatus.ABSENT ? '无故缺勤，照扣课时' : undefined,
        createdById: owner,
        createdAt: a.recordedAt,
      };
    });

  await prisma.creditLedger.createMany({ data: consumeLedger });

  // 按实际消耗扣减余额，使 balance === sum(ledger)
  for (const [studentId, count] of consumed) {
    await prisma.creditAccount.update({
      where: { studentId },
      data: { balance: { decrement: count } },
    });
  }

  // 对账校验：任何不平立即报错，不让不一致的数据流到 demo
  const drift = await prisma.$queryRaw<{ studentId: string; balance: number; sum: number }[]>`
    SELECT a."studentId", a."balance", COALESCE(SUM(l."delta"), 0)::int AS sum
    FROM "CreditAccount" a
    LEFT JOIN "CreditLedger" l ON l."studentId" = a."studentId"
    GROUP BY a."studentId", a."balance"
    HAVING a."balance" <> COALESCE(SUM(l."delta"), 0)::int
  `;

  if (drift.length > 0) {
    throw new Error(`账目不平：${drift.length} 个学生的 balance 与流水之和不一致`);
  }
  console.log(`  ✓ 全部 ${students.length} 个账户 balance === sum(ledger)`);

  const demoTodayCount = await prisma.classSession.count({
    where: { teacherId: demoTeacher.id, startsAt: { gte: today, lt: addDays(today, 1) } },
  });

  console.log('\n完成。账号（密码均为 demo1234）：');
  console.log('  admin@demo.local     王顾问 —— 名下 72 名学生');
  console.log('  admin2@demo.local    王顾问之外的 admin，用于验证归属隔离');
  console.log('  teacher@demo.local   李老师 —— 今天有课');
  console.log('  teacher2@demo.local  另一位老师，用于验证只能看自己的课');
  console.log(`\n数据量：200 学生 / 20 老师 / 10 admin / ${groups.length} 个班`);
  console.log(
    `课次：过去 ${pastSessions} 节（含 ${attendanceRows.length} 条出勤与反馈）/ 今天 ${todaySessions} 节`,
  );
  console.log(`demo 老师今天有 ${demoTodayCount} 节课 —— 老师视角 demo 一定不是空页`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
