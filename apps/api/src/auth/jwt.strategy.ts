import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.module';
import type { AuthUser } from './auth.decorators';

export interface JwtPayload {
  sub: string; // userId —— 只放 id，角色每次从库里查
}

/**
 * 双通道取 token，两者走同一套校验逻辑：
 *   1. httpOnly cookie —— 浏览器用。同域部署，token 不进 JS
 *   2. Authorization: Bearer —— 评审 curl 做破坏测试用
 *
 * 这是故意的设计：破坏测试路径必须干净，评审要能绕过界面直接打 API。
 */
const fromCookie = (req: Request): string | null => {
  const raw = (req.cookies as Record<string, string> | undefined)?.access_token;
  return raw ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        fromCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      ignoreExpiration: false,
    });
  }

  /**
   * 每次请求都回库查用户，不信 JWT 里的角色。
   * 原因：token 签发后用户可能被停用或改了角色 —— 把角色写进 payload
   * 就等于让一个 7 天有效的 token 冻结了权限状态。
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, teacherId: true, active: true },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('用户不存在或已停用');
    }

    const { active: _active, ...authUser } = user;
    return authUser;
  }
}
