import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

/**
 * Enforces `@RequirePermissions(...)`. Registered globally AFTER the JWT guard,
 * so `request.user` (with its resolved `permissions` + `isSuperAdmin`) is already
 * populated. Routes with no `@RequirePermissions` need only authentication;
 * `@Public()` routes are skipped entirely.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new ForbiddenException('غير مصرح — يرجى تسجيل الدخول');
    if (user.isSuperAdmin) return true;

    const granted = new Set(user.permissions ?? []);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException('ليس لديك صلاحية للقيام بهذا الإجراء');
    }
    return true;
  }
}
