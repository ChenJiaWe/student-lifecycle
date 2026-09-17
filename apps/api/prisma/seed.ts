import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * 阶段 3 的最小 seed：只建能登录的账号，用于验证 auth 与 guards。
 * 完整的演示数据（学生、班级、课次、课时）在阶段 7 补全。
 *
 * ⚠ 完整 seed 必须用相对日期：所有课次相对运行时的"今天"推算，
 * 并保证"今天"一定有课 —— 否则评审隔几天打开老师视角是空白页。
 */
async function main(): Promise<void> {
  const password = await bcrypt.hash('demo1234', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.local' },
    update: {},
    create: {
      email: 'admin@demo.local',
      passwordHash: password,
      name: '王顾问',
      role: Role.ADMIN,
    },
  });

  const teacherProfile = await prisma.teacher.upsert({
    where: { id: 'seed-teacher-1' },
    update: {},
    create: {
      id: 'seed-teacher-1',
      name: '李老师',
      subjects: ['写作', '口语'],
    },
  });

  const teacher = await prisma.user.upsert({
    where: { email: 'teacher@demo.local' },
    update: {},
    create: {
      email: 'teacher@demo.local',
      passwordHash: password,
      name: '李老师',
      role: Role.TEACHER,
      teacherId: teacherProfile.id,
    },
  });

  // 第二个 admin：用于验证"只能改自己名下的学生"（规则 7）
  const otherAdmin = await prisma.user.upsert({
    where: { email: 'admin2@demo.local' },
    update: {},
    create: {
      email: 'admin2@demo.local',
      passwordHash: password,
      name: '张顾问',
      role: Role.ADMIN,
    },
  });

  // 各自名下一个学生，破坏测试要用
  for (const [owner, name] of [
    [admin, '李小红'],
    [otherAdmin, '陈子豪'],
  ] as const) {
    const student = await prisma.student.upsert({
      where: { id: `seed-student-${owner.id.slice(-6)}` },
      update: {},
      create: {
        id: `seed-student-${owner.id.slice(-6)}`,
        name,
        grade: '七年级',
        ownerAdminId: owner.id,
      },
    });

    await prisma.creditAccount.upsert({
      where: { studentId: student.id },
      update: {},
      create: { studentId: student.id, balance: 3 },
    });
  }

  console.log('seed 完成');
  console.log('  admin    admin@demo.local    / demo1234  （王顾问，名下：李小红）');
  console.log('  admin2   admin2@demo.local   / demo1234  （张顾问，名下：陈子豪）');
  console.log('  teacher  teacher@demo.local  / demo1234  （李老师）');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
