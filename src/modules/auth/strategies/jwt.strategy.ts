import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import {
  AuthenticatedUser,
  JwtPayload,
} from '../interfaces/jwt-payload.interface';
import {
  ALL_BRANCHES_PERMISSION,
  PermissionsService,
} from '../../permissions/permissions.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly permissionsService: PermissionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // jwt.secret is guaranteed present (see jwt.config: fails fast if unset).
      secretOrKey: configService.get<string>('jwt.secret') as string,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload?.sub) {
      throw new UnauthorizedException('رمز الدخول غير صالح');
    }

    // Resolve permissions from the role on every request so a permission or
    // role change takes effect immediately (no need to wait for token refresh).
    const resolved = await this.permissionsService.resolveForRole(payload.roleId);

    // null → sees ALL branches (super-admin or the all-branches permission).
    // Otherwise the scope is the user's assigned branch set (empty = sees none).
    const branchIds = payload.branchIds ?? [];
    const seesAllBranches =
      resolved.isSuperAdmin || resolved.keys.includes(ALL_BRANCHES_PERMISSION);
    const branchScope: string[] | null = seesAllBranches ? null : branchIds;

    return {
      userId: payload.sub,
      username: payload.username,
      email: payload.email,
      roleId: payload.roleId,
      roleCode: resolved.roleCode,
      branchIds,
      companyId: payload.companyId,
      permissions: resolved.keys,
      isSuperAdmin: resolved.isSuperAdmin,
      branchScope,
    };
  }
}
