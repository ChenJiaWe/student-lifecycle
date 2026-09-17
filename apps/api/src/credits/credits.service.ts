import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerReason, Prisma, Role, TaskStatus, TaskType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import { OwnershipService } from '../auth/ownership.service';
import type { AuthUser } from '../auth/auth.decorators';

/**
 * 课时账本。
 *
 * 核心原则：CreditLedger 是流水，只追加、不更新、不删除。
 * CreditAccount.balance 是同事务内维护的物化值 —— 物化的唯一目的
 * 是能挂 CHECK (balance >= 0)，让数据库成为负余额的最后一道墙。
 *
 * 换句话说：余额不是"存起来省查询"，是"存起来让数据库能校验"。
 */
@Injectable()
export class CreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownership: OwnershipService,
  ) {}

  /**
   * 扣课时（点名时调用）。
   *
   * 幂等键 = "consume:{sessionId}:{studentId}"：
   * 重复请求撞 idempotencyKey 唯一约束 → 返回既有结果，不重复扣。
   * 这是规则 4 的第二道保障（第一道是 Attendance 的唯一约束）。
   *
   * 必须在调用方的事务内执行 —— 扣款与写出勤要么都成，要么都不成。
   */
  async consumeInTx(
    tx: Prisma.TransactionClient,
    params: {
      studentId: string;
      sessionId: string;
      attendanceId: string;
      operatorId: string;
      note?: string;
    },
  ): Promise<{ deducted: boolean; balance: number }> {
    const key = `consume:${params.sessionId}:${params.studentId}`;

    const already = await tx.creditLedger.findUnique({ where: { idempotencyKey: key } });
    if (already) {
      const acc = await tx.creditAccount.findUnique({ where: { studentId: params.studentId } });
      return { deducted: false, balance: acc?.balance ?? 0 };
    }

    // 行锁：序列化同一学生的余额变更，防并发双扣
    await tx.$queryRaw`SELECT id FROM "CreditAccount" WHERE "studentId" = ${params.studentId} FOR UPDATE`;

    const account = await tx.creditAccount.findUnique({
      where: { studentId: params.studentId },
    });

    if (!account) {
      throw new NotFoundException('该学生没有课时账户');
    }

    await tx.creditLedger.create({
      data: {
        studentId: params.studentId,
        delta: -1,
        reason: LedgerReason.CONSUME,
        sessionId: params.sessionId,
        attendanceId: params.attendanceId,
        idempotencyKey: key,
        note: params.note,
        createdById: params.operatorId,
      },
    });

    // 余额为 0 时这一步会撞 CHECK 约束 → 事务回滚 → 422（规则 3）
    const updated = await tx.creditAccount.update({
      where: { studentId: params.studentId },
      data: { balance: { decrement: 1 } },
    });

    return { deducted: true, balance: updated.balance };
  }

  /**
   * 反向记账（出勤订正用）。
   *
   * 账本只能冲正不能删改 —— 所以订正不是改那条 CONSUME 记录，
   * 而是写一条新的 +1 ADJUST。两条记录都留着，审计链完整。
   */
  async reverseConsumeInTx(
    tx: Prisma.TransactionClient,
    params: {
      studentId: string;
      sessionId: string;
      attendanceId: string;
      operatorId: string;
      note: string;
    },
  ): Promise<{ reversed: boolean; balance: number }> {
    const consumeKey = `consume:${params.sessionId}:${params.studentId}`;
    const reverseKey = `reverse:${params.sessionId}:${params.studentId}`;

    const original = await tx.creditLedger.findUnique({ where: { idempotencyKey: consumeKey } });
    if (!original) {
      // 原本就没扣（试听 / 请假），无需冲正
      const acc = await tx.creditAccount.findUnique({ where: { studentId: params.studentId } });
      return { reversed: false, balance: acc?.balance ?? 0 };
    }

    const alreadyReversed = await tx.creditLedger.findUnique({
      where: { idempotencyKey: reverseKey },
    });
    if (alreadyReversed) {
      const acc = await tx.creditAccount.findUnique({ where: { studentId: params.studentId } });
      return { reversed: false, balance: acc?.balance ?? 0 };
    }

    await tx.$queryRaw`SELECT id FROM "CreditAccount" WHERE "studentId" = ${params.studentId} FOR UPDATE`;

    await tx.creditLedger.create({
      data: {
        studentId: params.studentId,
        delta: 1,
        reason: LedgerReason.ADJUST,
        sessionId: params.sessionId,
        attendanceId: params.attendanceId,
        idempotencyKey: reverseKey,
        note: `出勤订正: ${params.note}`,
        createdById: params.operatorId,
      },
    });

    const updated = await tx.creditAccount.update({
      where: { studentId: params.studentId },
      data: { balance: { increment: 1 } },
    });

    return { reversed: true, balance: updated.balance };
  }

  /**
   * 购买课时。
   *
   * ⚠ 权限说明：admin 能给自己名下的学生加课时，这在真实系统里应该
   * 只有 manager 能做（否则等于 admin 能凭空送钱）。第一版没有 manager
   * 角色，所以靠强制 note + 记录操作人 + 流水可审计来兜。
   * 这是已知的权限缺口，见 DESIGN.md。
   */
  async purchase(
    user: AuthUser,
    input: { studentId: string; credits: number; amountCents: number; note?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.ownership.assertCanMutateStudent(user, input.studentId, tx);

      const purchase = await tx.creditPurchase.create({
        data: {
          studentId: input.studentId,
          credits: input.credits,
          amountCents: input.amountCents,
          createdById: user.id,
        },
      });

      await tx.creditLedger.create({
        data: {
          studentId: input.studentId,
          delta: input.credits,
          reason: LedgerReason.PURCHASE,
          purchaseId: purchase.id,
          note: input.note,
          createdById: user.id,
        },
      });

      const account = await tx.creditAccount.upsert({
        where: { studentId: input.studentId },
        update: { balance: { increment: input.credits } },
        create: { studentId: input.studentId, balance: input.credits },
      });

      // 买了课时后，原先的低余额任务就该关掉了
      await tx.followUpTask.updateMany({
        where: {
          studentId: input.studentId,
          type: TaskType.LOW_BALANCE,
          status: TaskStatus.OPEN,
        },
        data: {
          status: TaskStatus.DONE,
          resolvedAt: new Date(),
          resolutionNote: `已购买 ${input.credits} 课时`,
        },
      });

      // 续费后学生回到正常状态
      await tx.student.updateMany({
        where: { id: input.studentId, status: { in: ['AT_RISK', 'TRIAL_ATTENDED'] } },
        data: { status: 'ENROLLED' },
      });

      return { purchaseId: purchase.id, balance: account.balance };
    });
  }

  /** 课时流水：admin 要能回答家长"我这 20 节课怎么用掉的" */
  async ledger(user: AuthUser, studentId: string) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('老师无权查看课时账目');
    }

    const [account, entries] = await Promise.all([
      this.prisma.creditAccount.findUnique({ where: { studentId } }),
      this.prisma.creditLedger.findMany({
        where: { studentId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          delta: true,
          reason: true,
          note: true,
          createdAt: true,
          createdBy: { select: { name: true } },
          purchase: { select: { amountCents: true } },
        },
      }),
    ]);

    return {
      balance: account?.balance ?? 0,
      lowBalanceThreshold: account?.lowBalanceThreshold ?? 4,
      entries,
    };
  }
}
