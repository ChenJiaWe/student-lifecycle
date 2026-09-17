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
   * TODO(阶段6): 接入千问的 structured output 调用。
   * 当前返回 available:false，前端已能正确展示降级 UI ——
   * 这是刻意的：降级路径先跑通，再接 LLM。
   */
  @Post()
  async generate(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string,
  ): Promise<DigestResult> {
    const input = await this.digest.collectInput(user, studentId);
    const hash = this.digest.inputHash(input);

    const cached = await this.digest.findCached(studentId, hash);
    if (cached) return cached;

    if (!this.digest.llmConfigured) {
      return { available: false, reason: '未配置 LLM key，简报功能暂不可用' };
    }

    return { available: false, reason: '简报生成功能开发中' };
  }
}
