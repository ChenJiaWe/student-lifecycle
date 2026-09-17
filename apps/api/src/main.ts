import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // 所有 API 挂 /api 前缀 —— 与 SPA 的 catch-all 路由分开
  app.setGlobalPrefix('api');
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // 剥掉 DTO 里没声明的字段
      forbidNonWhitelisted: true, // 传了多余字段直接 400，而不是静默忽略
      transform: true,
    }),
  );

  // 把数据库约束违反翻译成 409/422，而不是裸露 500。
  // 破坏测试打的正是这些点 —— 状态码要说明"规则拦住了你"而非"服务端崩了"
  app.useGlobalFilters(new PrismaExceptionFilter());

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);

  new Logger('Bootstrap').log(
    `API 已启动 http://localhost:${port}/api · 业务时区 ${config.get('BUSINESS_TIMEZONE')}`,
  );
}

void bootstrap();
