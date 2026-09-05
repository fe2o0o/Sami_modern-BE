import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Role } from '../role/entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { sanitizePermissionKeys } from './permission.catalog';

/** The code of the built-in role that bypasses every permission check. */
export const SUPER_ADMIN_ROLE_CODE = 'ADMIN';

/** Holding this permission lets a user see data across ALL branches. */
export const ALL_BRANCHES_PERMISSION = 'all_branches.view';

export interface ResolvedRolePermissions {
  roleCode: string | null;
  /** ADMIN → true; such a role is granted every permission implicitly. */
  isSuperAdmin: boolean;
  keys: string[];
}

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  /** The raw granted keys of a role (empty for a super-admin — it bypasses). */
  async getRolePermissionKeys(roleId: string): Promise<string[]> {
    const rows = await this.rolePermissionRepository.find({ where: { roleId } });
    return rows.map((r) => r.permissionKey);
  }

  /**
   * Resolve what a role can do — used by the JWT strategy (per request) and the
   * permissions guard. A super-admin role reports `isSuperAdmin: true` and its
   * explicit keys are irrelevant.
   */
  async resolveForRole(roleId: string): Promise<ResolvedRolePermissions> {
    const role = await this.roleRepository.findOne({ where: { id: roleId } });
    const isSuperAdmin = role?.code === SUPER_ADMIN_ROLE_CODE;
    if (isSuperAdmin) {
      return { roleCode: role?.code ?? null, isSuperAdmin: true, keys: [] };
    }
    const keys = await this.getRolePermissionKeys(roleId);
    return { roleCode: role?.code ?? null, isSuperAdmin: false, keys };
  }

  /**
   * Replace a role's permissions with `keys` (validated against the catalog).
   * A super-admin role's permissions are implicit and never stored.
   */
  async setRolePermissions(
    roleId: string,
    keys: string[],
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager
      ? manager.getRepository(RolePermission)
      : this.rolePermissionRepository;
    const clean = sanitizePermissionKeys(keys);

    await repo.delete({ roleId });
    if (clean.length) {
      await repo.insert(clean.map((permissionKey) => ({ roleId, permissionKey })));
    }
  }
}
