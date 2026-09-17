import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module';
import type { AuthUser } from './auth.decorators';

/**
 * 规则 7：admin 可读全部学生，但只能修改自己名下的；teacher 不能改学生。
 *
 * 为什么做成 service 而不是 Guard：
 * 归属校验要查库，而后续的写操作通常在事务里。做成 Guard 的话校验发生在
 * 事务之外 —— 校验通过到真正写入之间存在时间窗（TOCTOU），并且会多查一次库。
 * 做成 service 就能把校验放进同一个事务、复用同一个 tx 客户端。
 *
 * 换句话说：Guard 适合无状态的角色判断（RolesGuard），
 * 需要读数据的授权判断放进事务更安全。
 */
@Injectable()
export class OwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 断言此用户有权修改该学生。传入 tx 则在同一事务内校验。
   * @throws NotFoundException 学生不存在
   * @throws ForbiddenException 学生属于别的 admin，或调用方是 teacher
   */
  async assertCanMutateStudent(
    user: AuthUser,
    studentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;

    const student = await db.student.findUnique({
      where: { id: studentId },
      select: { id: true, ownerAdminId: true },
    });

    if (!student) {
      throw new NotFoundException(`学生 ${studentId} 不存在`);
    }

    // 老师不碰学生档案和钱 —— 他们只点名、写反馈
    if (user.role === Role.TEACHER) {
      throw new ForbiddenException('老师无权修改学生信息');
    }

    if (student.ownerAdminId !== user.id) {
      throw new ForbiddenException('只能修改自己名下的学生');
    }
  }

  /**
   * 读权限：admin 可读全部（背景里 admin 之间需要互相协作），
   * teacher 只能读自己课上的学生。
   */
  async assertCanReadStudent(user: AuthUser, studentId: string): Promise<void> {
    if (user.role === Role.ADMIN) return;

    const taught = await this.prisma.sessionParticipant.findFirst({
      where: { studentId, session: { teacherId: user.teacherId ?? '__none__' } },
      select: { id: true },
    });

    if (!taught) {
      throw new ForbiddenException('只能查看自己课上的学生');
    }
  }
}
