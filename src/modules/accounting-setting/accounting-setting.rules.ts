import {
  AccountSubType,
  AccountType,
} from '../chart-of-account/enums/account.enum';

/** Validation/lookup rule for one accounting-settings account field. */
export interface SettingAccountRule {
  /** Field on AccountingSetting / the update DTO. */
  key: string;
  label: string;
  accountType: AccountType;
  /** Allowed fine-grained classifications (account must be one of these). */
  subTypes: AccountSubType[];
}

/**
 * Single source of truth mapping each accounting-settings field to the accounts
 * that may fill it. Drives BOTH the filtered dropdown options endpoint and the
 * server-side PUT validation, so the two can never drift apart.
 */
export const SETTING_ACCOUNT_RULES: SettingAccountRule[] = [
  {
    key: 'salesRevenueAccountId',
    label: 'حساب إيرادات المبيعات',
    accountType: AccountType.REVENUE,
    subTypes: [
      AccountSubType.SALES_REVENUE,
      AccountSubType.EXPORT_REVENUE,
      AccountSubType.OTHER_REVENUE,
    ],
  },
  {
    key: 'customerControlAccountId',
    label: 'حساب مراقبة العملاء',
    accountType: AccountType.ASSET,
    subTypes: [AccountSubType.ACCOUNTS_RECEIVABLE],
  },
  {
    key: 'supplierControlAccountId',
    label: 'حساب مراقبة الموردين',
    accountType: AccountType.LIABILITY,
    subTypes: [AccountSubType.ACCOUNTS_PAYABLE],
  },
  {
    key: 'rawMaterialInventoryAccountId',
    label: 'حساب مخزون المواد الخام',
    accountType: AccountType.ASSET,
    subTypes: [
      AccountSubType.INVENTORY_RAW_MATERIAL,
      AccountSubType.INVENTORY_WIP,
      AccountSubType.INVENTORY_FINISHED_GOODS,
    ],
  },
  {
    key: 'finishedGoodsInventoryAccountId',
    label: 'حساب مخزون المنتج التام',
    accountType: AccountType.ASSET,
    subTypes: [
      AccountSubType.INVENTORY_FINISHED_GOODS,
      AccountSubType.INVENTORY_WIP,
      AccountSubType.INVENTORY_RAW_MATERIAL,
    ],
  },
  {
    key: 'costOfGoodsSoldAccountId',
    label: 'حساب تكلفة البضاعة المباعة',
    accountType: AccountType.EXPENSE,
    subTypes: [AccountSubType.COGS],
  },
  {
    key: 'inventoryAdjustmentAccountId',
    label: 'حساب تسويات المخزون',
    accountType: AccountType.EXPENSE,
    subTypes: [AccountSubType.INVENTORY_ADJUSTMENT],
  },
  {
    key: 'manufacturingFeeAccountId',
    label: 'حساب رسوم التصنيع (داخلي)',
    accountType: AccountType.EXPENSE,
    subTypes: [
      AccountSubType.MANUFACTURING_EXPENSE,
      AccountSubType.OPERATING_EXPENSE,
      AccountSubType.OTHER_EXPENSE,
    ],
  },
  {
    key: 'defaultCashAccountId',
    label: 'حساب النقدية الافتراضي',
    accountType: AccountType.ASSET,
    subTypes: [AccountSubType.CASH],
  },
  {
    key: 'defaultBankAccountId',
    label: 'حساب البنك الافتراضي',
    accountType: AccountType.ASSET,
    subTypes: [AccountSubType.BANK],
  },
  {
    key: 'inputVatAccountId',
    label: 'ضريبة القيمة المضافة - المشتريات',
    accountType: AccountType.ASSET,
    subTypes: [AccountSubType.TAX_RECEIVABLE],
  },
  {
    key: 'outputVatAccountId',
    label: 'ضريبة القيمة المضافة - المبيعات',
    accountType: AccountType.LIABILITY,
    subTypes: [AccountSubType.TAX_PAYABLE],
  },
  {
    key: 'commissionExpenseAccountId',
    label: 'حساب مصروف عمولات المبيعات',
    accountType: AccountType.EXPENSE,
    subTypes: [AccountSubType.OPERATING_EXPENSE, AccountSubType.OTHER_EXPENSE],
  },
  {
    key: 'commissionPayableAccountId',
    label: 'حساب عمولات مستحقة للموظفين',
    accountType: AccountType.LIABILITY,
    subTypes: [AccountSubType.SALARY_PAYABLE, AccountSubType.OTHER_PAYABLE],
  },
  {
    key: 'openingBalanceEquityAccountId',
    label: 'حساب موازنة الأرصدة الافتتاحية',
    accountType: AccountType.EQUITY,
    // Prefer a dedicated account, but the business may legitimately configure
    // Capital or Retained Earnings for opening-balance balancing.
    subTypes: [
      AccountSubType.OPENING_BALANCE_EQUITY,
      AccountSubType.CAPITAL,
      AccountSubType.RETAINED_EARNINGS,
    ],
  },
];

export const SETTING_ACCOUNT_RULE_BY_KEY = new Map(
  SETTING_ACCOUNT_RULES.map((r): [string, SettingAccountRule] => [r.key, r]),
);
