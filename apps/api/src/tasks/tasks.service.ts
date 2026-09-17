import { Injectable, Logger } from '@nestjs/common';
import {
  AttendanceStatus,
  Prisma,
  SessionType,
  TaskCreator,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { addDays } from 'date-fns';

/** 连续缺勤达到这个次数就开风险任务 */
const ABSENCE_STREAK_THRESHOLD = 2;

/**
 * 跟进任务：把"今天我要处理谁"直接推到 admin 眼前，
 * 而不是给他一张 100 人的表让他自己翻。
 *
 * 三个触发源直击背景里的痛点：
 *   - 试听完没人跟进  → TRIAL_FOLLOWUP
 *   - 课时用完才发现  → LOW_BALANCE
 *   - 学生悄悄流失     → ABSENCE_RISK
 *
 * 去重靠数据库的 one_open_task_per_type partial unique index：
 * 同一学生同一类型只能有一条 OPEN，否则每次点名都会刷一条。
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  /**
   * 在事务内开任务。撞去重索引时静默跳过 —— 已有待处理任务不是错误。
   */
  private async openTask(
    tx: Prisma.TransactionClient,
    params: {
      studentId: string;
      ownerAdminId: string;
      type: TaskType;
      reason: string;
      dueAt: Date;
      sourceSessionId?: string;
    },
  ): Promise<boolean> {
    try {
      await tx.followUpTask.create({
        data: {
          studentId: params.studentId,
          ownerAdminId: params.ownerAdminId,
          type: params.type,
          reason: params.reason,
          dueAt: params.dueAt,
          sourceSessionId: params.sourceSessionId,
          createdBy: TaskCreator.SYSTEM,
        },
      });
      return true;
    } catch (err) {
      // P2002 = 已有同类型 OPEN 任务，符合预期
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return false;
      }
      throw err;
    }
  }

  /**
   * 点名提交后的副作用：根据出勤与余额决定要不要开跟进任务。
   *
   * 注意这是在点名的同一个事务里跑的 —— 出勤写了、课时扣了、
   * 任务也开了，三件事原子完成。
   */
  async evaluateAfterAttendance(
    tx: Prisma.TransactionClient,
    params: {
      studentId: string;
      sessionId: string;
      sessionType: SessionType;
      status: AttendanceStatus;
      balanceAfter: number;
    },
  ): Promise<TaskType[]> {
    const student = await tx.student.findUnique({
      where: { id: params.studentId },
      select: {
        ownerAdminId: true,
        name: true,
        account: { select: { lowBalanceThreshold: true } },
      },
    });

    if (!student) return [];

    const opened: TaskType[] = [];
    const now = new Date();

    // ① 试听课上完 → 必须有人跟进（直击"试听完没人跟进"）
    if (params.sessionType === SessionType.TRIAL) {
      const ok = await this.openTask(tx, {
        studentId: params.studentId,
        ownerAdminId: student.ownerAdminId,
        type: TaskType.TRIAL_FOLLOWUP,
        reason: '试听已完成，待跟进报名意向',
        dueAt: addDays(now, 1),
        sourceSessionId: params.sessionId,
      });
      if (ok) opened.push(TaskType.TRIAL_FOLLOWUP);

      await tx.student.update({
        where: { id: params.studentId },
        data: { status: 'TRIAL_ATTENDED' },
      });

      // 试听不扣课时，所以不检查余额
      return opened;
    }

    // ② 余额低于阈值 → 提醒续费（直击"课时用完才发现"）
    const threshold = student.account?.lowBalanceThreshold ?? 4;
    if (params.balanceAfter <= threshold) {
      const ok = await this.openTask(tx, {
        studentId: params.studentId,
        ownerAdminId: student.ownerAdminId,
        type: TaskType.LOW_BALANCE,
        reason: `剩余 ${params.balanceAfter} 课时，需联系家长续费`,
        dueAt: addDays(now, params.balanceAfter <= 1 ? 0 : 3),
        sourceSessionId: params.sessionId,
      });
      if (ok) opened.push(TaskType.LOW_BALANCE);

      if (params.balanceAfter <= 1) {
        await tx.student.updateMany({
          where: { id: params.studentId, status: 'ENROLLED' },
          data: { status: 'AT_RISK' },
        });
      }
    }

    // ③ 连续缺勤 → 可能在悄悄流失
    if (params.status === AttendanceStatus.ABSENT) {
      const recent = await tx.attendance.findMany({
        where: { studentId: params.studentId },
        orderBy: { recordedAt: 'desc' },
        take: ABSENCE_STREAK_THRESHOLD,
        select: { status: true },
      });

      const streak =
        recent.length >= ABSENCE_STREAK_THRESHOLD &&
        recent.every((a) => a.status === AttendanceStatus.ABSENT);

      if (streak) {
        const ok = await this.openTask(tx, {
          studentId: params.studentId,
          ownerAdminId: student.ownerAdminId,
          type: TaskType.ABSENCE_RISK,
          reason: `连续 ${ABSENCE_STREAK_THRESHOLD} 次缺勤，有流失风险`,
          dueAt: now,
          sourceSessionId: params.sessionId,
        });
        if (ok) opened.push(TaskType.ABSENCE_RISK);

        await tx.student.updateMany({
          where: { id: params.studentId, status: 'ENROLLED' },
          data: { status: 'AT_RISK' },
        });
      }
    }

    return opened;
  }

  /** 关闭任务（admin 处理完） */
  async resolve(
    tx: Prisma.TransactionClient,
    taskId: string,
    status: TaskStatus,
    note?: string,
  ) {
    return tx.followUpTask.update({
      where: { id: taskId },
      data: { status, resolvedAt: new Date(), resolutionNote: note },
    });
  }
}
