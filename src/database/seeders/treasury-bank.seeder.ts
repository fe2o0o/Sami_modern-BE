import { DataSource } from 'typeorm';
import { Branch } from '../../modules/branch/entities/branch.entity';
import { AccountingSetting } from '../../modules/accounting-setting/entities/accounting-setting.entity';
import { Treasury } from '../../modules/treasury/entities/treasury.entity';
import { BankAccount } from '../../modules/bank-account/entities/bank-account.entity';
import { Seeder } from './seeder.interface';

/**
 * Provisions a default treasury (cashbox) and a default bank account for the
 * main branch, mapped to the cash/bank GL accounts configured in Accounting
 * Settings. Runs after ChartOfAccount + AccountingSetting so those accounts
 * exist. Idempotent — skips whatever already exists.
 */
export class TreasuryBankSeeder implements Seeder {
  readonly name = 'TreasuryBankSeeder';

  async run(dataSource: DataSource): Promise<void> {
    const branchRepo = dataSource.getRepository(Branch);
    const settingRepo = dataSource.getRepository(AccountingSetting);
    const treasuryRepo = dataSource.getRepository(Treasury);
    const bankRepo = dataSource.getRepository(BankAccount);

    const branch = await branchRepo.findOne({ where: { isMain: true } });
    if (!branch) {
      throw new Error('Main branch must be seeded before treasuries/banks');
    }

    const settings = await settingRepo.findOne({ where: {} });

    // Default treasury → cash GL account.
    const existingTreasury = await treasuryRepo.findOne({
      where: { branchId: branch.id },
    });
    if (!existingTreasury && settings?.defaultCashAccountId) {
      await treasuryRepo.save(
        treasuryRepo.create({
          code: 'TR-001',
          name: 'الخزينة الرئيسية',
          branchId: branch.id,
          accountId: settings.defaultCashAccountId,
          isDefault: true,
          isActive: true,
        }),
      );
    }

    // Default bank account → bank GL account.
    const existingBank = await bankRepo.findOne({
      where: { branchId: branch.id },
    });
    if (!existingBank && settings?.defaultBankAccountId) {
      await bankRepo.save(
        bankRepo.create({
          code: 'BNK-001',
          bankName: 'البنك الرئيسي',
          accountName: 'الحساب الرئيسي',
          branchId: branch.id,
          accountId: settings.defaultBankAccountId,
          currencyCode: 'EGP',
          isDefault: true,
          isActive: true,
        }),
      );
    }
  }
}
