import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * Injects the current principal's branch scope: a branchId string when the user
 * is restricted to a single branch, or `null` when they may see every branch
 * (super-admin, `all_branches.view` holders, or users with no branch).
 *
 *   findAll(@Query() q: Dto, @BranchScope() branchScope: string | null) { ... }
 */
export const BranchScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser | undefined;
    return user?.branchScope ?? null;
  },
);
