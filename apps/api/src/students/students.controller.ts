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

  @Get(':id')
  async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.ownership.assertCanReadStudent(user, id);

    return this.prisma.student.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        grade: true,
        status: true,
        note: true,
        ownerAdmin: { select: { id: true, name: true } },
        account: { select: { balance: true, lowBalanceThreshold: true } },
      },
    });
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
