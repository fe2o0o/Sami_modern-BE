import { DataSource } from 'typeorm';
import { Customer } from '../../modules/customer/entities/customer.entity';
import { Seeder } from './seeder.interface';

/** Seeds sample customers. Idempotent by code. */
export class CustomerSeeder implements Seeder {
  readonly name = 'CustomerSeeder';

  private readonly customers: Partial<Customer>[] = [
    { code: 'CUS-0001', name: 'شركة الأمل للتجارة', nameEn: 'Al Amal Trading', mobile: '01000000001', city: 'القاهرة', country: 'مصر', creditLimit: 50000, paymentTerms: 30 },
    { code: 'CUS-0002', name: 'معرض النخبة للأثاث', nameEn: 'Elite Furniture Showroom', mobile: '01000000002', city: 'الجيزة', country: 'مصر', creditLimit: 30000, paymentTerms: 15 },
    { code: 'CUS-0003', name: 'مؤسسة البيت الحديث', nameEn: 'Modern Home Est.', mobile: '01000000003', city: 'الإسكندرية', country: 'مصر', creditLimit: 20000, paymentTerms: 0 },
  ];

  async run(dataSource: DataSource): Promise<void> {
    const repo = dataSource.getRepository(Customer);
    for (const customer of this.customers) {
      const exists = await repo.findOne({ where: { code: customer.code } });
      if (exists) {
        continue;
      }
      await repo.save(repo.create({ ...customer, isActive: true }));
    }
  }
}
