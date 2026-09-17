import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsISO8601, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { SchedulingService } from './scheduling.service';
import { CreditsService } from '../credits/credits.service';
import { CurrentUser, Roles, type AuthUser } from '../auth/auth.decorators';

class EnrollDto {
  @IsString() classGroupId!: string;
  @IsOptional() @IsISO8601() startDate?: string;
}

class TrialDto {
  @IsString() teacherId!: string;
  @IsISO8601() startsAt!: string;
  @IsInt() @Min(15) @Max(300) durationMin!: number;
  @IsOptional() @IsString() @MaxLength(50) room?: string;
}

class PurchaseDto {
  @IsInt() @Min(1) @Max(500) credits!: number;
  @IsInt() @Min(0) amountCents!: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

@Controller('students/:studentId')
@Roles(Role.ADMIN)
export class SchedulingController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly credits: CreditsService,
  ) {}

  /** 排课抽屉的数据源：每个班标注可排/不可排及原因 */
  @Get('class-options')
  options(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    return this.scheduling.listOptionsForStudent(user, studentId);
  }

  /** 排进固定班：校验学生冲突 + 容量，生成未来课次 */
  @Post('enroll')
  enroll(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Body() dto: EnrollDto,
  ) {
    return this.scheduling.enrollStudent(user, {
      studentId,
      classGroupId: dto.classGroupId,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
    });
  }

  /** 安排试听：复用同一套冲突检测，一学生仅一次（DB 索引兜底） */
  @Post('trial')
  trial(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Body() dto: TrialDto,
  ) {
    return this.scheduling.scheduleTrial(user, {
      studentId,
      teacherId: dto.teacherId,
      startsAt: new Date(dto.startsAt),
      durationMin: dto.durationMin,
      room: dto.room,
    });
  }

  @Get('credits')
  ledger(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    return this.credits.ledger(user, studentId);
  }

  @Post('credits/purchase')
  purchase(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
    @Body() dto: PurchaseDto,
  ) {
    return this.credits.purchase(user, { studentId, ...dto });
  }
}
