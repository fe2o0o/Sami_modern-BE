import { DataSource } from 'typeorm';
import { AccountingSetting } from '../../modules/accounting-setting/entities/accounting-setting.entity';
import { ChartOfAccount } from '../../modules/chart-of-account/entities/chart-of-account.entity';
import { Seeder } from './seeder.interface';

/**
 * Maps the V1 default accounts onto the single accounting-settings row,
 * resolving each account safely BY CODE (never by hardcoded UUID). Only fills
 * a field that is still null, so it never overwrites a manual configuration.
 */
export class AccountingSettingSeeder implements Seeder {
  readonly name = 'AccountingSettingSeeder';

  private readonly defaultsByCode: Record<
    keyof Pick<
      AccountingSetting,
      | 'salesRevenueAccountId'
      | 'customerControlAccountId'
      | 'supplierControlAccountId'
      | 'rawMaterialInventoryAccountId'
      | 'finishedGoodsInventoryAccountId'
      | 'costOfGoodsSoldAccountId'
      | 'inventoryAdjustmentAccountId'
      | 'defaultCashAccountId'
      | 'defaultBankAccountId'
      | 'inputVatAccountId'
      | 'outputVatAccountId'
      | 'commissionExpenseAccountId'
      | 'commissionPayableAccountId'
      | 'openingBalanceEquityAccountId'
    >,
    string
  > = {
    salesRevenueAccountId: '410000',
    customerControlAccountId: '121000',
    supplierControlAccountId: '211000',
    rawMaterialInventoryAccountId: '131000',
    finishedGoodsInventoryAccountId: '133000',
    costOfGoodsSoldAccountId: '510000',
    inventoryAdjustmentAccountId: '612000',
    defaultCashAccountId: '111000',
    defaultBankAccountId: '112000',
    inputVatAccountId: '122000',
    outputVatAccountId: '221000',
    commissionExpenseAccountId: '613000',
    commissionPayableAccountId: '231000',
    openingBalanceEquityAccountId: '330000',
  };

  async run(dataSource: DataSource): Promise<void> {
    const settingRepo = dataSource.getRepository(AccountingSetting);
    const accountRepo = dataSource.getRepository(ChartOfAccount);

    let setting = await settingRepo.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    if (!setting) {
      setting = settingRepo.create({});
    }

    for (const [field, code] of Object.entries(this.defaultsByCode)) {
      const key = field as keyof typeof this.defaultsByCode;
      if (setting[key]) {
        continue; // already configured — never overwrite
      }
      const account = await accountRepo.findOne({
        where: { accountCode: code },
      });
      if (account) {
        setting[key] = account.id;
      }
    }

    await settingRepo.save(setting);
  }
}
