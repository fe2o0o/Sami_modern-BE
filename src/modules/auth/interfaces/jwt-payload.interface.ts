/** Shape of the signed JWT access-token payload. */
export interface JwtPayload {
  sub: string; // userId
  username: string;
  email: string;
  roleId: string;
  branchId: string | null;
  companyId: string | null;
}

/** Authenticated principal attached to `request.user` by the JWT strategy. */
export interface AuthenticatedUser {
  userId: string;
  username: string;
  email: string;
  roleId: string;
  roleCode: string | null;
  branchId: string | null;
  companyId: string | null;
  /** Resolved from the role on every request — fresh, so revocation is instant. */
  permissions: string[];
  /** ADMIN role → bypasses every permission check. */
  isSuperAdmin: boolean;
  /**
   * The branch this principal is restricted to for data access, or `null` to see
   * ALL branches (super-admin, holders of `all_branches.view`, or users with no
   * branch). Services filter branch-scoped queries by this value when set.
   */
  branchScope: string | null;
}
