import { DataSource } from 'typeorm';
import { Role } from '../../modules/role/entities/role.entity';
import { RolePermission } from '../../modules/permissions/entities/role-permission.entity';
import {
  ALL_PERMISSION_KEYS,
  sanitizePermissionKeys,
} from '../../modules/permissions/permission.catalog';
import { SUPER_ADMIN_ROLE_CODE } from '../../modules/permissions/permissions.service';
import { Seeder } from './seeder.interface';

/**
 * Seeds default permission sets for the built-in non-admin roles. ADMIN is a
 * super-admin (bypasses checks) so it needs no rows. Idempotent: a role that
 * already has any permission row is left untouched, so UI edits are preserved.
 */
export class PermissionSeeder implements Seeder {
  readonly name = 'PermissionSeeder';

  /** ACCOUNTANT: everything except user/role administration. */
  private accountantKeys(): string[] {
    return ALL_PERMISSION_KEYS.filter(
      (k) => !k.startsWith('users.') && !k.startsWith('roles.'),
    );
  }

  /** USER: a day-to-day sales operator — mostly view, plus sell & receipt. */
  private readonly userKeys = sanitizePermissionKeys([
    'sales_invoices.view', 'sales_invoices.create', 'sales_invoices.edit', 'sales_invoices.post',
    'sales_returns.view',
    'purchase_invoices.view',
    'vouchers.view', 'vouchers.create', 'vouchers.edit', 'vouchers.post',
    'stock.view',
    'products.view', 'customers.view', 'suppliers.view',
    'accounting_reports.view',
  ]);

  async run(dataSource: DataSource): Promise<void> {
    const roleRepo = dataSource.getRepository(Role);
    const rpRepo = dataSource.getRepository(RolePermission);

    const defaults: Record<string, string[]> = {
      ACCOUNTANT: this.accountantKeys(),
      USER: this.userKeys,
    };

    for (const [code, keys] of Object.entries(defaults)) {
      if (code === SUPER_ADMIN_ROLE_CODE) continue;
      const role = await roleRepo.findOne({ where: { code } });
      if (!role) continue;

      const existing = await rpRepo.count({ where: { roleId: role.id } });
      if (existing > 0) continue; // already configured — don't clobber

      const clean = sanitizePermissionKeys(keys);
      if (clean.length) {
        await rpRepo.insert(clean.map((permissionKey) => ({ roleId: role.id, permissionKey })));
      }
    }
  }
}
