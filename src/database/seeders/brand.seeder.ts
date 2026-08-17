import { DataSource } from 'typeorm';
import { Brand } from '../../modules/brand/entities/brand.entity';
import { Seeder } from './seeder.interface';

/** Seeds a set of furniture brands. Idempotent by code. */
export class BrandSeeder implements Seeder {
  readonly name = 'BrandSeeder';

  private readonly brands: Partial<Brand>[] = [
    { code: 'SAMI', name: 'سامي', nameEn: 'Sami', description: 'العلامة التجارية الرئيسية للشركة' },
    { code: 'IKEA', name: 'ايكيا', nameEn: 'IKEA' },
    { code: 'HOMEC', name: 'هوم سنتر', nameEn: 'Home Centre' },
    { code: 'MODRN', name: 'مودرن هوم', nameEn: 'Modern Home' },
    { code: 'CLASC', name: 'كلاسيك', nameEn: 'Classic' },
  ];

  async run(dataSource: DataSource): Promise<void> {
    const repo = dataSource.getRepository(Brand);
    for (const brand of this.brands) {
      const exists = await repo.findOne({ where: { code: brand.code } });
      if (exists) {
        continue;
      }
      await repo.save(repo.create({ ...brand, isActive: true }));
    }
  }
}
