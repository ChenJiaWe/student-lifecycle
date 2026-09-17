import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth.decorators';
import { PrismaService } from './prisma/prisma.module';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 部署平台的健康检查端点。
   * 同时兼作 Neon compute 的唤醒入口 —— 面试前先打这个预热。
   */
  @Public()
  @Get()
  async check() {
    const started = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      status: 'ok',
      dbLatencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }
}
