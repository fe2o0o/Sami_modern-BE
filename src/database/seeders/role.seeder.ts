import { DataSource } from 'typeorm';
import { Role } from '../../modules/role/entities/role.entity';
import { Seeder } from './seeder.interface';

/** Seeds the built-in roles (idempotent, keyed by code). */
export class RoleSeeder implements Seeder {
  readonly name = 'RoleSeeder';

  private readonly roles: Partial<Role>[] = [
    { code: 'ADMIN', name: 'مدير النظام', nameEn: 'Administrator', isSystem: true, isActive: true },
    { code: 'ACCOUNTANT', name: 'محاسب', nameEn: 'Accountant', isSystem: false, isActive: true },
    { code: 'USER', name: 'مستخدم', nameEn: 'User', isSystem: false, isActive: true },
  ];

  async run(dataSource: DataSource): Promise<void> {
    const repo = dataSource.getRepository(Role);
    for (const data of this.roles) {
      const exists = await repo.findOne({ where: { code: data.code } });
      if (!exists) {
        await repo.save(repo.create(data));
      }
    }
  }
}
