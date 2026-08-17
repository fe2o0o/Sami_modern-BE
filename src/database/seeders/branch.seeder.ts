import { DataSource } from 'typeorm';
import { Branch } from '../../modules/branch/entities/branch.entity';
import { Company } from '../../modules/company/entities/company.entity';
import { Warehouse } from '../../modules/warehouse/entities/warehouse.entity';
import { WarehouseType } from '../../modules/warehouse/enums/warehouse-type.enum';
import { Seeder } from './seeder.interface';

/**
 * Ensures a Main Branch exists for the company AND that it has a default
 * warehouse — mirroring the auto-provisioning the BranchService does on create.
 * Idempotent: safe to re-run.
 */
export class BranchSeeder implements Seeder {
  readonly name = 'BranchSeeder';

  async run(dataSource: DataSource): Promise<void> {
    const branchRepo = dataSource.getRepository(Branch);
    const companyRepo = dataSource.getRepository(Company);
    const warehouseRepo = dataSource.getRepository(Warehouse);

    const company = await companyRepo.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    if (!company) {
      throw new Error('Company must be seeded before the main branch');
    }

    let branch = await branchRepo.findOne({ where: { isMain: true } });
    if (!branch) {
      branch = await branchRepo.save(
        branchRepo.create({
          code: 'BR-001',
          name: 'الفرع الرئيسي',
          companyId: company.id,
          isMain: true,
          isActive: true,
          country: 'مصر',
        }),
      );
    }

    // Default warehouse for the main branch.
    const existingWarehouse = await warehouseRepo.findOne({
      where: { branchId: branch.id },
    });
    if (!existingWarehouse) {
      await warehouseRepo.save(
        warehouseRepo.create({
          code: `WH-${branch.code}`,
          name: `مخزن ${branch.name}`,
          type: WarehouseType.STORE,
          branchId: branch.id,
          isDefault: true,
          isActive: true,
        }),
      );
    }
  }
}
