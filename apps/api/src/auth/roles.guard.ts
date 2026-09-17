import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { ROLES_KEY, type AuthUser } from './auth.decorators';

/**
 * 角色校验：@Roles('ADMIN') 之类。
 * 未标注 @Roles 的端点对所有已登录用户开放（但仍需登录）。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException('未认证');

    if (!required.includes(user.role)) {
      throw new ForbiddenException(`此操作需要角色 ${required.join(' 或 ')}`);
    }

    return true;
  }
}
