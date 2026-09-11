import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { BranchScope as BranchScopeType } from '../../../common/utils/branch-scope.util';

/**
 * Injects the current principal's branch scope: an array of branch ids the user
 * may access, or `null` when they may see every branch (super-admin or
 * `all_branches.view` holders). An empty array = restricted with no branches.
 *
 *   findAll(@Query() q: Dto, @BranchScope() branchScope: string[] | null) { ... }
 */
export const BranchScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): BranchScopeType => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser | undefined;
    return user?.branchScope ?? null;
  },
);
