import { Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DigestService, type DigestResult } from './digest.service';
import { CurrentUser, Roles, type AuthUser } from '../auth/auth.decorators';

/**
 * 续费沟通简报。
 *
 * 只在 admin 主动点击时调用（POST），不在页面加载时自动跑 —— 控制成本。
 * GET 返回降级上下文，页面加载时就取，这样简报失败也有东西可展示。
 */
@Controller('students/:studentId/digest')
@Roles(Role.ADMIN)
export class DigestController {
  constructor(private readonly digest: DigestService) {}

  /** 降级上下文：原始反馈时间线 + 出勤统计。页面加载即取 */
  @Get('fallback')
  fallback(@CurrentUser() user: AuthUser, @Param('studentId') studentId: string) {
    return this.digest.fallbackContext(studentId);
  }

  /**
   * 生成简报。
   *
   * 取数、缓存、调模型、校验、落库全在 service 里，控制器只转发 ——
   * 失败不抛异常而是返回 available:false，前端据此展示降级 UI。
   * 未配 key、超时、校验不过走的都是同一条返回路径，前端只需要处理一种形状。
   */
  @Post()
  generate(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
  ): Promise<DigestResult> {
    return this.digest.generate(user, studentId);
  }
}
