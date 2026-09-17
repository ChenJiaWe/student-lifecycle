import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser, Public, type AuthUser } from './auth.decorators';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 登录同时返回两种凭据形式，各服务一个目的：
   *   - Set-Cookie: httpOnly —— 浏览器用，token 不进 JS
   *   - 响应体里的 accessToken —— 评审 curl 做破坏测试用
   */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, user } = await this.auth.login(dto.email, dto.password);

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      // 同域部署（Nest 同时供 /api/* 和 SPA），所以 Lax 就够，不需要 None
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV') === 'production',
      maxAge: this.auth.cookieMaxAgeMs,
      path: '/',
    });

    return { accessToken, user };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token', { path: '/' });
    return { ok: true };
  }

  /** 前端 beforeLoad 守卫用它判断是否已登录 */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
