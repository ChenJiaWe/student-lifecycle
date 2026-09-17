import { Controller, Get, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SchedulingService } from './scheduling.service';
import { CurrentUser, Roles, type AuthUser } from '../auth/auth.decorators';

/**
 * 试听管理列表
 *
 * 独立于 SchedulingController（挂在 /students/:id 下）的顶层端点，
 * 让 admin 在一个视图里看到所有待跟进的试听，而不必逐一打开学生详情。
 */
@Controller('trials')
@Roles(Role.ADMIN)
export class TrialsController {
  constructor(private readonly scheduling: SchedulingService) {}

  /** 我名下所有学生的试听记录（未来 + 已过去） */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.scheduling.listTrials(user);
  }
}

/**
 * 课次滚动补齐
 *
 * enrollStudent 在入学时只生成 2 周课次；这个端点补全未来 4 周。
 * 生产环境由 ScheduleCronService 每周一凌晨 2 时自动调用，
 * 也可以通过此端点手动触发（部署后立即补全、或测试用）。
 */
@Controller('sessions')
@Roles(Role.ADMIN)
export class SessionsExtendController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Post('extend-upcoming')
  extend() {
    return this.scheduling.extendUpcomingSessions(4);
  }
}
