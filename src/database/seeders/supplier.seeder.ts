import { DataSource } from 'typeorm';
import { Supplier } from '../../modules/supplier/entities/supplier.entity';
import { Seeder } from './seeder.interface';

/** Seeds sample suppliers. Idempotent by code. */
export class SupplierSeeder implements Seeder {
  readonly name = 'SupplierSeeder';

  private readonly suppliers: Partial<Supplier>[] = [
    { code: 'SUP-0001', name: 'مصنع الخشب الحديث', nameEn: 'Modern Wood Factory', mobile: '01100000001', city: 'دمياط', country: 'مصر', paymentTerms: 30 },
    { code: 'SUP-0002', name: 'شركة الأقمشة المتحدة', nameEn: 'United Fabrics Co.', mobile: '01100000002', city: 'المحلة', country: 'مصر', paymentTerms: 45 },
    { code: 'SUP-0003', name: 'مؤسسة الإكسسوارات المعدنية', nameEn: 'Metal Accessories Est.', mobile: '01100000003', city: 'القاهرة', country: 'مصر', paymentTerms: 15 },
  ];

  async run(dataSource: DataSource): Promise<void> {
    const repo = dataSource.getRepository(Supplier);
    for (const supplier of this.suppliers) {
      const exists = await repo.findOne({ where: { code: supplier.code } });
      if (exists) {
        continue;
      }
      await repo.save(repo.create({ ...supplier, isActive: true }));
    }
  }
}
