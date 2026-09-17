import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@prisma/client';

/** 标记无需登录的端点（登录、健康检查） */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** 限制端点可访问的角色 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** 已认证用户在请求上的形状 —— 故意不含 passwordHash */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  teacherId: string | null;
}

/** 取出当前登录用户：@CurrentUser() user: AuthUser */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest().user as AuthUser;
  },
);
