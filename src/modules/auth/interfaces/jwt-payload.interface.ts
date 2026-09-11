import { BranchScope } from '../../../common/utils/branch-scope.util';

/** Shape of the signed JWT access-token payload. */
export interface JwtPayload {
  sub: string; // userId
  username: string;
  email: string;
  roleId: string;
  /** Branches assigned to this user (empty = none). */
  branchIds: string[];
  companyId: string | null;
}

/** Authenticated principal attached to `request.user` by the JWT strategy. */
export interface AuthenticatedUser {
  userId: string;
  username: string;
  email: string;
  roleId: string;
  roleCode: string | null;
  /** Branches assigned to this user (empty = none). */
  branchIds: string[];
  companyId: string | null;
  /** Resolved from the role on every request — fresh, so revocation is instant. */
  permissions: string[];
  /** ADMIN role → bypasses every permission check. */
  isSuperAdmin: boolean;
  /**
   * The branches this principal may access, or `null` to see ALL branches
   * (super-admin or holders of `all_branches.view`). An empty array means the
   * user is branch-restricted with no assigned branches (sees nothing). Services
   * filter branch-scoped queries by this via the branch-scope helpers.
   */
  branchScope: BranchScope;
}
