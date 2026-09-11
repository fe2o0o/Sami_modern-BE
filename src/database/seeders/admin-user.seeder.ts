import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../modules/user/entities/user.entity';
import { Role } from '../../modules/role/entities/role.entity';
import { Branch } from '../../modules/branch/entities/branch.entity';
import { Seeder } from './seeder.interface';

/** Seeds the single administrator account (idempotent). */
export class AdminUserSeeder implements Seeder {
  readonly name = 'AdminUserSeeder';

  async run(dataSource: DataSource): Promise<void> {
    const userRepo = dataSource.getRepository(User);
    const roleRepo = dataSource.getRepository(Role);
    const branchRepo = dataSource.getRepository(Branch);

    const exists = await userRepo.findOne({
      where: [{ username: 'admin' }, { email: 'admin@samy.com' }],
    });
    if (exists) {
      return;
    }

    const adminRole = await roleRepo.findOne({ where: { code: 'ADMIN' } });
    const mainBranch = await branchRepo.findOne({ where: { isMain: true } });
    if (!adminRole || !mainBranch) {
      throw new Error('Roles and main branch must be seeded before the admin user');
    }

    await userRepo.save(
      userRepo.create({
        fullName: 'مدير النظام',
        username: 'admin',
        email: 'admin@samy.com',
        password: await bcrypt.hash('Admin@123', 10),
        roleId: adminRole.id,
        branches: [mainBranch],
        isActive: true,
        isLocked: false,
      }),
    );
  }
}
