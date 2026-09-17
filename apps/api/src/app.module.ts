import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'node:path';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { StudentsModule } from './students/students.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // monorepo 根目录的 .env（api 与 web 共用一份）。
      // 同样锚定 cwd：__dirname 在 nest start 与生产构建下层级不同
      envFilePath: [join(process.cwd(), '../../.env')],
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    StudentsModule,

    // 生产环境下单服务托管 SPA 产物：同域 → 零 CORS、cookie 天然 first-party。
    //
    // 路径锚定 process.cwd()（即 apps/api）而非 __dirname：后者在
    // `nest start`（dist/src/）与 `node dist/main.js`（dist/）下层级不同，
    // 用相对 __dirname 的写法两种模式必有一个是错的。
    //
    // exclude 的模式必须是 '/api/(.*)' —— 实测 '/api/*' 和 '/api*' 都不匹配。
    // 原因：isRouteExcluded 用 path-to-regexp 且会在 pathname 后补一个斜杠，
    // 通配符 * 在该版本下不产生期望的正则。写错的后果很隐蔽：
    // /api/ 下未匹配的路由会返回 index.html（200）而不是 404，
    // 前端 fetch 拿到一段 HTML 后报 JSON 解析错误，排查方向会被带偏。
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), '../web/dist'),
      exclude: ['/api/(.*)'],
    }),
  ],
  controllers: [HealthController],
  providers: [
    // 全局注册：默认所有端点需登录（@Public() 例外）。
    // 默认拒绝而非默认放行 —— 新端点忘加守卫时是 401，不是裸奔
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
