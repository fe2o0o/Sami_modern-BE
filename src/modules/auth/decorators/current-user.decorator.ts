import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * Extracts the authenticated user (populated by JwtStrategy) from the request.
 *
 *   findAll(@CurrentUser() user: AuthenticatedUser) { ... }
 *   me(@CurrentUser('userId') userId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser | undefined;
    return data ? user?.[data] : user;
  },
);
