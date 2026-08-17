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
  branchId: string | null;
  companyId: string | null;
}
