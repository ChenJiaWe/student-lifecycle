import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AttendanceStatus, Role, SessionType } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.module';
import { OwnershipService } from '../src/auth/ownership.service';
import type { AuthUser } from '../src/auth/auth.decorators';
import { AttendanceService } from '../src/attendance/attendance.service';
import { CreditsService } from '../src/credits/credits.service';
import { SchedulingService } from '../src/scheduling/scheduling.service';
import { TasksService } from '../src/tasks/tasks.service';
import { melbourneWallClockToUtc, upcomingWeekdayDates } from '../src/common/timezone.util';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL must point to a disposable local test database');
const target = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    target.pathname !== '/student_lifecycle_test') {
  throw new Error('Tests require a local database named student_lifecycle_test');
}

const prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
const ownership = new OwnershipService(prisma);
const credits = new CreditsService(prisma, ownership);
const attendance = new AttendanceService(prisma, credits, new TasksService());
const scheduling = new SchedulingService(prisma, ownership);

before(async () => {
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_URL_UNPOOLED: databaseUrl,
      SHADOW_DATABASE_URL: databaseUrl,
    },
    stdio: 'pipe',
  });
  await prisma.$connect();
});
after(async () => { await prisma.$disconnect(); });

async function fixture(balance = 10) {
  const id = randomUUID();
  const teacher = await prisma.teacher.create({ data: { name: 'Test teacher', subjects: [] } });
  const admin: AuthUser = await prisma.user.create({ data: {
    email: `${id}-admin@test.local`, passwordHash: 'unused', name: 'Owner', role: Role.ADMIN,
  } });
  const other: AuthUser = await prisma.user.create({ data: {
    email: `${id}-other@test.local`, passwordHash: 'unused', name: 'Other', role: Role.ADMIN,
  } });
  const tutor: AuthUser = await prisma.user.create({ data: {
    email: `${id}-teacher@test.local`, passwordHash: 'unused', name: 'Teacher',
    role: Role.TEACHER, teacherId: teacher.id,
  } });
  const student = await prisma.student.create({ data: {
    name: 'Test student', ownerAdminId: admin.id, status: 'ENROLLED',
    account: { create: { balance: 0 } },
  } });
  if (balance > 0) {
    await credits.purchase(admin, { studentId: student.id, credits: balance, amountCents: 100 });
  }
  let sessionNumber = 0;
  const session = async (type: SessionType = SessionType.REGULAR) => {
    const startsAt = new Date(Date.UTC(2026, 0, ++sessionNumber, 0));
    return prisma.classSession.create({ data: {
      teacherId: teacher.id, type, startsAt, endsAt: new Date(startsAt.getTime() + 3600000),
      participants: { create: { studentId: student.id, source: type === 'TRIAL' ? 'TRIAL' : 'ENROLLMENT' } },
    } });
  };
  const correct = (sessionId: string, status: AttendanceStatus, user = admin) =>
    attendance.correct(user, sessionId, { studentId: student.id, status, note: 'Regression correction' });
  const submit = (sessionId: string, status: AttendanceStatus, user = tutor) =>
    attendance.submit(user, sessionId, [{ studentId: student.id, status }]);
  const assertBalance = async (expected: number) => {
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { studentId: student.id } });
    const ledger = await prisma.creditLedger.aggregate({ where: { studentId: student.id }, _sum: { delta: true } });
    assert.equal(account.balance, expected);
    assert.equal(account.balance, ledger._sum.delta ?? 0, 'balance must equal the entire ledger sum');
  };
  return { admin, other, tutor, teacher, student, session, submit, correct, assertBalance };
}

test('existing low-balance task does not abort the next attendance transaction', async () => {
  const f = await fixture(4);
  await f.submit((await f.session()).id, 'PRESENT');
  await f.submit((await f.session()).id, 'PRESENT');
  await f.assertBalance(2);
  assert.equal(await prisma.followUpTask.count({ where: { studentId: f.student.id, type: 'LOW_BALANCE', status: 'OPEN' } }), 1);
  assert.equal(await prisma.attendance.count({ where: { studentId: f.student.id } }), 2);
});

test('admin cannot submit attendance for another admin\'s student', async () => {
  const f = await fixture();
  const s = await f.session();
  await assert.rejects(f.submit(s.id, 'PRESENT', f.other), ForbiddenException);
  await f.assertBalance(10);
  assert.equal(await prisma.attendance.count({ where: { sessionId: s.id } }), 0);
});

test('admin cannot correct attendance for another admin\'s student', async () => {
  const f = await fixture();
  const s = await f.session();
  await f.submit(s.id, 'PRESENT');
  await assert.rejects(f.correct(s.id, 'EXCUSED', f.other), ForbiddenException);
  await f.assertBalance(9);
});

test('repeated corrections reconcile charges and preserve original ledger entries', async () => {
  const f = await fixture();
  const s = await f.session();
  await f.submit(s.id, 'PRESENT');
  const originals = await prisma.creditLedger.findMany({ where: { studentId: f.student.id } });
  for (const [status, expected] of [
    ['EXCUSED', 10], ['PRESENT', 9], ['EXCUSED', 10], ['LATE', 9], ['ABSENT', 9],
  ] as const) {
    await f.correct(s.id, status);
    await f.assertBalance(expected);
  }
  for (const entry of originals) {
    assert.deepEqual(await prisma.creditLedger.findUnique({ where: { id: entry.id } }), entry);
  }
  assert.equal(await prisma.creditLedger.count({ where: { studentId: f.student.id, sessionId: s.id } }), 5);
});

test('trial corrections never charge credits', async () => {
  const f = await fixture(0);
  const s = await f.session('TRIAL');
  await f.submit(s.id, 'EXCUSED');
  await f.correct(s.id, 'PRESENT');
  await f.correct(s.id, 'EXCUSED');
  await f.assertBalance(0);
  assert.equal(await prisma.creditLedger.count({ where: { studentId: f.student.id } }), 0);
});

test('insufficient balance rolls back both correction and its ledger entry', async () => {
  const f = await fixture(0);
  const s = await f.session();
  await f.submit(s.id, 'EXCUSED');
  await assert.rejects(f.correct(s.id, 'PRESENT'));
  await f.assertBalance(0);
  const record = await prisma.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: s.id, studentId: f.student.id } } });
  assert.equal(record.status, 'EXCUSED');
  assert.equal(record.correctedById, null);
});

test('concurrent identical corrections refund once and reject the stale transition', async () => {
  const f = await fixture();
  const s = await f.session();
  await f.submit(s.id, 'PRESENT');
  const results = await Promise.allSettled([f.correct(s.id, 'EXCUSED'), f.correct(s.id, 'EXCUSED')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const failed = results.find((r) => r.status === 'rejected');
  assert.ok(failed?.status === 'rejected' && failed.reason instanceof BadRequestException);
  await f.assertBalance(10);
});

test('five concurrent submissions charge exactly once', async () => {
  const f = await fixture();
  const s = await f.session();
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => f.submit(s.id, 'PRESENT')));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await f.assertBalance(9);
  assert.equal(await prisma.attendance.count({ where: { sessionId: s.id } }), 1);
});

test('concurrent enrolments cannot exceed the last seat', async () => {
  const f = await fixture();
  const course = await prisma.course.create({ data: { name: 'Capacity regression', subject: 'Math' } });
  const anchor = new Date('2026-11-02T00:00:00Z');
  const group = await prisma.classGroup.create({ data: {
    courseId: course.id, teacherId: f.teacher.id, weekday: 1, startTimeLocal: '16:00',
    durationMin: 60, capacity: 1, startDate: anchor,
  } });
  const dates = upcomingWeekdayDates(anchor, group.weekday, 2);
  await prisma.classSession.createMany({ data: dates.map((date) => {
    const startsAt = melbourneWallClockToUtc(date, group.startTimeLocal);
    return { classGroupId: group.id, teacherId: f.teacher.id, startsAt, endsAt: new Date(startsAt.getTime() + 3600000) };
  }) });
  const students = await Promise.all(Array.from({ length: 6 }, () => prisma.student.create({ data: {
    name: 'Concurrent applicant', ownerAdminId: f.admin.id,
  } })));
  const results = await Promise.allSettled(students.map((student) => scheduling.enrollStudent(f.admin, {
    studentId: student.id, classGroupId: group.id, startDate: anchor,
  })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const result of results) {
    if (result.status === 'rejected') assert.ok(result.reason instanceof ConflictException);
  }
  assert.equal(await prisma.enrollment.count({ where: { classGroupId: group.id, status: 'ACTIVE' } }), 1);
});
