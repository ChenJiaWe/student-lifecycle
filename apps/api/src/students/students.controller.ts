import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.module';
import { OwnershipService } from '../auth/ownership.service';
import { CurrentUser, Roles, type AuthUser } from '../auth/auth.decorators';

class UpdateStudentDto {
  @IsOptional() @IsString() @MaxLength(50) name?: string;
  @IsOptional() @IsString() @MaxLength(20) grade?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/**
 * 阶段 3 只做最小的读写端点，用于验证规则 7（归属校验）。
 * 完整的学生管理在阶段 4-5 展开。
 */
@Controller('students')
export class StudentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  /** admin 可读全部学生（背景里 admin 之间需要协作），teacher 只读自己课上的 */
  @Get()
  @Roles(Role.ADMIN)
  async list(@CurrentUser() user: AuthUser) {
    const students = await this.prisma.student.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        ownerAdminId: true,
        ownerAdmin: { select: { name: true } },
        account: { select: { balance: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // 标出哪些是自己的 —— 前端据此决定是否显示编辑入口（体验层，非把关）
    return students.map((s) => ({ ...s, isMine: s.ownerAdminId === user.id }));
  }

  /**
   * 学生详情 —— 一页看全，前端不用打五个接口再自己拼。
   *
   * 包含：基本信息 + 联系人（主联系人/付款人）+ 课时流水
   * + 在读班级 + 最近出勤与反馈 + 待跟进任务。
   *
   * 课时区返回的是流水而不是一个数字：课时是钱，admin 要能回答家长
   * "我这 20 节课怎么用掉的"。
   */
  @Get(':id')
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.ownership.assertCanReadStudent(user, id);
    const isAdmin = user.role === Role.ADMIN;

    const student = await this.prisma.student.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        grade: true,
        status: true,
        note: true,
        source: true,
        createdAt: true,
        ownerAdmin: { select: { id: true, name: true } },
        account: { select: { balance: true, lowBalanceThreshold: true } },
        guardians: {
          select: {
            relation: true,
            isPrimaryContact: true,
            isPayer: true,
            guardian: { select: { id: true, name: true, phone: true, email: true, wechat: true } },
          },
          orderBy: { isPrimaryContact: 'desc' },
        },
        enrollments: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            startDate: true,
            classGroup: {
              select: {
                id: true,
                weekday: true,
                startTimeLocal: true,
                durationMin: true,
                room: true,
                course: { select: { name: true, subject: true } },
                teacher: { select: { name: true } },
              },
            },
          },
        },
        attendance: {
          orderBy: { recordedAt: 'desc' },
          take: 12,
          select: {
            id: true,
            status: true,
            teacherNote: true,
            recordedAt: true,
            correctedAt: true,
            correctionNote: true,
            session: {
              select: {
                id: true,
                type: true,
                startsAt: true,
                classGroup: { select: { course: { select: { name: true } } } },
              },
            },
            recordedBy: { select: { name: true } },
          },
        },
        tasks: {
          where: { status: 'OPEN' },
          orderBy: { dueAt: 'asc' },
          select: { id: true, type: true, reason: true, dueAt: true, createdBy: true },
        },
      },
    });

    // 课时流水只给 admin —— 老师不碰钱的账（与 CreditsService.ledger 一致）
    const ledger = isAdmin
      ? await this.prisma.creditLedger.findMany({
          where: { studentId: id },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: {
            id: true,
            delta: true,
            reason: true,
            note: true,
            createdAt: true,
            createdBy: { select: { name: true } },
            purchase: { select: { amountCents: true } },
            sessionId: true,
          },
        })
      : [];

    const balance = student.account?.balance ?? 0;
    const threshold = student.account?.lowBalanceThreshold ?? 4;

    return {
      ...student,
      isMine: student.ownerAdmin.id === user.id,
      credits: isAdmin
        ? { balance, lowBalanceThreshold: threshold, isLow: balance <= threshold, ledger }
        // 老师只看到布尔标记，看不到具体余额（见 DESIGN.md 假设 6）
        : { isLow: balance <= threshold },
      // 出勤统计：简报降级时前端展示这个
      attendanceStats: {
        total: student.attendance.length,
        present: student.attendance.filter((a) => a.status === 'PRESENT').length,
        late: student.attendance.filter((a) => a.status === 'LATE').length,
        absent: student.attendance.filter((a) => a.status === 'ABSENT').length,
        excused: student.attendance.filter((a) => a.status === 'EXCUSED').length,
      },
    };
  }

  /**
   * 规则 7：只能修改自己名下的学生。
   * 校验在事务内做（见 OwnershipService 的设计说明），不是 Guard。
   */
  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.ownership.assertCanMutateStudent(user, id, tx);

      return tx.student.update({
        where: { id },
        data: dto,
        select: { id: true, name: true, grade: true, note: true },
      });
    });
  }
}
