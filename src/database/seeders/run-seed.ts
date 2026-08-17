import dataSource from '../data-source';
import { Seeder } from './seeder.interface';
import { CompanySeeder } from './company.seeder';
import { RoleSeeder } from './role.seeder';
import { BranchSeeder } from './branch.seeder';
import { AdminUserSeeder } from './admin-user.seeder';
import { FiscalYearSeeder } from './fiscal-year.seeder';
import { ChartOfAccountSeeder } from './chart-of-account.seeder';
import { AccountingSettingSeeder } from './accounting-setting.seeder';
import { TreasuryBankSeeder } from './treasury-bank.seeder';
import { UnitSeeder } from './unit.seeder';
import { BrandSeeder } from './brand.seeder';
import { ProductCategorySeeder } from './product-category.seeder';
import { ProductSeeder } from './product.seeder';
import { CustomerSeeder } from './customer.seeder';
import { SupplierSeeder } from './supplier.seeder';

/** Registered seeders, executed in order (products depend on the three above). */
const seeders: Seeder[] = [
  new CompanySeeder(),
  new RoleSeeder(),
  new BranchSeeder(),
  new AdminUserSeeder(),
  new FiscalYearSeeder(),
  new ChartOfAccountSeeder(),
  new AccountingSettingSeeder(),
  new TreasuryBankSeeder(),
  new UnitSeeder(),
  new BrandSeeder(),
  new ProductCategorySeeder(),
  new ProductSeeder(),
  new CustomerSeeder(),
  new SupplierSeeder(),
];

/**
 * Standalone seed runner (outside the Nest DI container).
 * Usage: `npm run seed`
 */
async function runSeeders() {
  await dataSource.initialize();
  // eslint-disable-next-line no-console
  console.log('🌱 Seeding database...');

  for (const seeder of seeders) {
    // eslint-disable-next-line no-console
    console.log(`  → ${seeder.name}`);
    await seeder.run(dataSource);
  }

  await dataSource.destroy();
  // eslint-disable-next-line no-console
  console.log('✅ Seeding complete.');
}

runSeeders().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
