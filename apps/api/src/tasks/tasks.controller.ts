import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Role, TaskStatus, TaskType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.module';
import { OwnershipService } from '../auth/ownership.service';
import { CurrentUser, Roles, type AuthUser } from '../auth/auth.decorators';

class ResolveTaskDto {
  @IsEnum([TaskStatus.DONE, TaskStatus.DISMISSED] as const, {
    message: 'status 只能是 DONE 或 DISMISSED',
  })
  status!: typeof TaskStatus.DONE | typeof TaskStatus.DISMISSED;

  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

/**
 * admin 工作台的数据源。
 *
 * 设计意图：把"今天我要处理谁"直接推到眼前，而不是给 admin 一张
 * 100 人的表让他自己翻。这正是背景里那些痛点的解药 ——
 * 试听完没跟进、课时用完才发现、学生悄悄流失。
 */
@Controller('tasks')
@Roles(Role.ADMIN)
export class TasksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  /**
   * 待跟进列表，按类型分组。
   *
   * 默认只看自己名下的 —— admin 各管约 100 名学生，别人的任务不是他的工作。
   * scope=all 可以看全部（背景里 admin 之间需要协作，比如同事请假时接手）。
   */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('scope') scope?: 'mine' | 'all',
  ) {
    const where = {
      status: TaskStatus.OPEN,
      ...(scope === 'all' ? {} : { ownerAdminId: user.id }),
    };

    const tasks = await this.prisma.followUpTask.findMany({
      where,
      // 逾期的排最前 —— 这是 admin 打开页面最该先看到的
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        type: true,
        reason: true,
        dueAt: true,
        createdAt: true,
        createdBy: true,
        student: {
          select: {
            id: true,
            name: true,
            grade: true,
            status: true,
            account: { select: { balance: true } },
            guardians: {
              where: { isPrimaryContact: true },
              select: { relation: true, guardian: { select: { name: true, phone: true } } },
              take: 1,
            },
            // 下次课时间：admin 打电话时会被家长问到
            participants: {
              where: { session: { startsAt: { gte: new Date() }, status: 'SCHEDULED' } },
              orderBy: { session: { startsAt: 'asc' } },
              take: 1,
              select: {
                session: {
                  select: {
                    startsAt: true,
                    classGroup: { select: { course: { select: { name: true } } } },
                  },
                },
              },
            },
          },
        },
        ownerAdmin: { select: { id: true, name: true } },
      },
    });

    const now = Date.now();
    const shaped = tasks.map((t) => {
      const contact = t.student.guardians[0];
      const next = t.student.participants[0]?.session;

      return {
        id: t.id,
        type: t.type,
        reason: t.reason,
        dueAt: t.dueAt,
        overdueDays: Math.max(0, Math.floor((now - t.dueAt.getTime()) / 86400000)),
        createdBy: t.createdBy,
        isMine: t.ownerAdmin.id === user.id,
        ownerName: t.ownerAdmin.name,
        student: {
          id: t.student.id,
          name: t.student.name,
          grade: t.student.grade,
          status: t.student.status,
          balance: t.student.account?.balance ?? 0,
          primaryContact: contact
            ? {
                name: contact.guardian.name,
                phone: contact.guardian.phone,
                relation: contact.relation,
              }
            : null,
        },
        nextSession: next
          ? { startsAt: next.startsAt, courseName: next.classGroup?.course.name ?? '试听课' }
          : null,
      };
    });

    // 按类型分组：界面上是三个分区，不是一条长列表
    const byType = (type: TaskType) => shaped.filter((t) => t.type === type);

    return {
      total: shaped.length,
      overdue: shaped.filter((t) => t.overdueDays > 0).length,
      groups: [
        { type: TaskType.TRIAL_FOLLOWUP, label: '试听待跟进', items: byType(TaskType.TRIAL_FOLLOWUP) },
        { type: TaskType.LOW_BALANCE, label: '课时将尽', items: byType(TaskType.LOW_BALANCE) },
        { type: TaskType.ABSENCE_RISK, label: '连续缺勤', items: byType(TaskType.ABSENCE_RISK) },
        { type: TaskType.FEEDBACK_RISK, label: '反馈风险信号', items: byType(TaskType.FEEDBACK_RISK) },
      ].filter((g) => g.items.length > 0),
    };
  }

  /** 工作台顶部的概览数字 */
  @Get('overview')
  async overview(@CurrentUser() user: AuthUser) {
    const [studentCount, openTasks, weekSessions, pendingTrials] = await Promise.all([
      this.prisma.student.count({ where: { ownerAdminId: user.id } }),
      this.prisma.followUpTask.count({ where: { ownerAdminId: user.id, status: TaskStatus.OPEN } }),
      this.prisma.classSession.count({
        where: {
          startsAt: { gte: new Date(), lte: new Date(Date.now() + 7 * 86400000) },
          status: 'SCHEDULED',
          participants: { some: { student: { ownerAdminId: user.id } } },
        },
      }),
      this.prisma.student.count({
        where: { ownerAdminId: user.id, status: 'TRIAL_SCHEDULED' },
      }),
    ]);

    return { studentCount, openTasks, weekSessions, pendingTrials };
  }

  /**
   * 处理任务。
   *
   * 归属校验走 OwnershipService —— 只能处理自己名下学生的任务，
   * 与"只能改自己的学生"是同一条规则（规则 7）。
   */
  @Post(':id/resolve')
  async resolve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveTaskDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.followUpTask.findUniqueOrThrow({
        where: { id },
        select: { studentId: true, status: true },
      });

      await this.ownership.assertCanMutateStudent(user, task.studentId, tx);

      return tx.followUpTask.update({
        where: { id },
        data: {
          status: dto.status,
          resolvedAt: new Date(),
          resolutionNote: dto.note,
        },
        select: { id: true, status: true, resolvedAt: true, resolutionNote: true },
      });
    });
  }
}
