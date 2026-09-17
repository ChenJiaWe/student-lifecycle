import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.module';
import type { AuthUser } from './auth.decorators';
import type { JwtPayload } from './jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<{ accessToken: string; user: AuthUser }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    // 用户不存在和密码错误返回同一个错误 —— 不泄露哪些邮箱已注册
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    // payload 只放 sub，角色每次请求从库里查（见 JwtStrategy.validate）
    const payload: JwtPayload = { sub: user.id };

    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        teacherId: user.teacherId,
      },
    };
  }

  /** cookie 有效期与 JWT 有效期保持一致，避免"cookie 还在但 token 过期"的怪状态 */
  get cookieMaxAgeMs(): number {
    const raw = this.config.get<string>('JWT_EXPIRES_IN', '7d');
    const match = /^(\d+)([smhd])$/.exec(raw);
    if (!match) return 7 * 24 * 3600 * 1000;

    const n = Number(match[1]);
    const unit = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[match[2]] ?? 86400e3;
    return n * unit;
  }
}
