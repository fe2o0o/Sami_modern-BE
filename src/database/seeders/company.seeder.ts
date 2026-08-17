import { DataSource } from 'typeorm';
import { Company } from '../../modules/company/entities/company.entity';
import { Seeder } from './seeder.interface';

/**
 * Ensures the single company record exists (idempotent).
 * The system is single-company, so this creates the one row if the table is empty.
 */
export class CompanySeeder implements Seeder {
  readonly name = 'CompanySeeder';

  async run(dataSource: DataSource): Promise<void> {
    const repo = dataSource.getRepository(Company);
    const count = await repo.count();
    if (count > 0) {
      return;
    }

    const company = repo.create({
      code: 'SAMI-001',
      name: 'سامي للأثاث',
      nameEn: 'Sami Furniture',
      legalName: 'شركة سامي للأثاث',
      currency: 'EGP',
      language: 'ar',
      timezone: 'Africa/Cairo',
      fiscalYearStart: '01-01',
      country: 'مصر',
      isActive: true,
    });

    await repo.save(company);
  }
}
