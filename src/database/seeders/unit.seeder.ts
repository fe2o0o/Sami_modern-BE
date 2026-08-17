import { DataSource } from 'typeorm';
import { Unit } from '../../modules/unit/entities/unit.entity';
import { Seeder } from './seeder.interface';

/** Seeds the common units of measure used by a furniture business. Idempotent by code. */
export class UnitSeeder implements Seeder {
  readonly name = 'UnitSeeder';

  private readonly units: Partial<Unit>[] = [
    { code: 'PCS', name: 'قطعة', nameEn: 'Piece', symbol: 'قطعة' },
    { code: 'MTR', name: 'متر', nameEn: 'Meter', symbol: 'م' },
    { code: 'M2', name: 'متر مربع', nameEn: 'Square Meter', symbol: 'م²' },
    { code: 'KG', name: 'كيلوجرام', nameEn: 'Kilogram', symbol: 'كجم' },
    { code: 'LTR', name: 'لتر', nameEn: 'Liter', symbol: 'ل' },
    { code: 'SET', name: 'طقم', nameEn: 'Set', symbol: 'طقم' },
    { code: 'HR', name: 'ساعة', nameEn: 'Hour', symbol: 'س' },
  ];

  async run(dataSource: DataSource): Promise<void> {
    const repo = dataSource.getRepository(Unit);
    for (const unit of this.units) {
      const exists = await repo.findOne({ where: { code: unit.code } });
      if (exists) {
        continue;
      }
      await repo.save(repo.create({ ...unit, isActive: true }));
    }
  }
}
