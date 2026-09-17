import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AttendanceStatus, Role } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AttendanceService } from './attendance.service';
import { CurrentUser, Roles, type AuthUser } from '../auth/auth.decorators';

class AttendanceRecordDto {
  @IsString() studentId!: string;
  @IsEnum(AttendanceStatus) status!: AttendanceStatus;
  @IsOptional() @IsString() @MaxLength(1000) teacherNote?: string;
}

class SubmitAttendanceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceRecordDto)
  records!: AttendanceRecordDto[];
}

class CorrectAttendanceDto {
  @IsString() studentId!: string;
  @IsEnum(AttendanceStatus) status!: AttendanceStatus;
  @IsString() @MaxLength(500) note!: string;
}

@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /** 老师登录后的首页数据 */
  @Get('teacher/today')
  @Roles(Role.TEACHER)
  today(@CurrentUser() user: AuthUser, @Query('day') day?: string) {
    return this.attendance.teacherToday(user, day ? new Date(day) : undefined);
  }

  @Get('sessions/:id/roster')
  roster(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attendance.roster(user, id);
  }

  /** 点名：写出勤 + 扣课时 + 触发任务，一个事务 */
  @Post('sessions/:id/attendance')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SubmitAttendanceDto,
  ) {
    return this.attendance.submit(user, id, dto.records);
  }

  /** 订正出勤：仅 admin，必填原因，走反向记账（规则 11） */
  @Post('sessions/:id/attendance/correct')
  @Roles(Role.ADMIN)
  correct(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CorrectAttendanceDto,
  ) {
    return this.attendance.correct(user, id, dto);
  }
}
