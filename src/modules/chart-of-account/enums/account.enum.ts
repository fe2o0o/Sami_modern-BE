/** Top-level classification of an account. */
export enum AccountType {
  ASSET = 'asset',
  LIABILITY = 'liability',
  EQUITY = 'equity',
  REVENUE = 'revenue',
  EXPENSE = 'expense',
}

/** Normal balance side of the account. */
export enum AccountNature {
  DEBIT = 'debit',
  CREDIT = 'credit',
}

/**
 * Fine-grained purpose of an account within its top-level type. Drives
 * setting-specific account filtering/validation (a Cash setting must resolve a
 * CASH account, not just any ASSET). Optional — accounts may be left
 * unclassified, but a classified account is required to appear in the
 * corresponding Accounting-Settings dropdown.
 */
export enum AccountSubType {
  // ASSET
  CASH = 'cash',
  BANK = 'bank',
  ACCOUNTS_RECEIVABLE = 'accounts_receivable',
  INVENTORY_RAW_MATERIAL = 'inventory_raw_material',
  INVENTORY_WIP = 'inventory_wip',
  INVENTORY_FINISHED_GOODS = 'inventory_finished_goods',
  FIXED_ASSET = 'fixed_asset',
  TAX_RECEIVABLE = 'tax_receivable',
  // LIABILITY
  ACCOUNTS_PAYABLE = 'accounts_payable',
  TAX_PAYABLE = 'tax_payable',
  SALARY_PAYABLE = 'salary_payable',
  OTHER_PAYABLE = 'other_payable',
  // EQUITY
  CAPITAL = 'capital',
  RETAINED_EARNINGS = 'retained_earnings',
  OPENING_BALANCE_EQUITY = 'opening_balance_equity',
  // REVENUE
  SALES_REVENUE = 'sales_revenue',
  EXPORT_REVENUE = 'export_revenue',
  SALES_RETURN = 'sales_return',
  OTHER_REVENUE = 'other_revenue',
  // EXPENSE
  COGS = 'cogs',
  INVENTORY_ADJUSTMENT = 'inventory_adjustment',
  OPERATING_EXPENSE = 'operating_expense',
  MANUFACTURING_EXPENSE = 'manufacturing_expense',
  OTHER_EXPENSE = 'other_expense',
}

export const ACCOUNT_SUBTYPE_LABELS: Record<AccountSubType, string> = {
  [AccountSubType.CASH]: 'نقدية / خزينة',
  [AccountSubType.BANK]: 'بنك',
  [AccountSubType.ACCOUNTS_RECEIVABLE]: 'ذمم مدينة (عملاء)',
  [AccountSubType.INVENTORY_RAW_MATERIAL]: 'مخزون مواد خام',
  [AccountSubType.INVENTORY_WIP]: 'مخزون تحت التشغيل',
  [AccountSubType.INVENTORY_FINISHED_GOODS]: 'مخزون منتج تام',
  [AccountSubType.FIXED_ASSET]: 'أصل ثابت',
  [AccountSubType.TAX_RECEIVABLE]: 'ضريبة مدينة (مشتريات)',
  [AccountSubType.ACCOUNTS_PAYABLE]: 'ذمم دائنة (موردون)',
  [AccountSubType.TAX_PAYABLE]: 'ضريبة دائنة (مبيعات)',
  [AccountSubType.SALARY_PAYABLE]: 'رواتب مستحقة',
  [AccountSubType.OTHER_PAYABLE]: 'التزامات أخرى',
  [AccountSubType.CAPITAL]: 'رأس المال',
  [AccountSubType.RETAINED_EARNINGS]: 'أرباح مرحّلة',
  [AccountSubType.OPENING_BALANCE_EQUITY]: 'موازنة الأرصدة الافتتاحية',
  [AccountSubType.SALES_REVENUE]: 'إيرادات مبيعات',
  [AccountSubType.EXPORT_REVENUE]: 'إيرادات تصدير',
  [AccountSubType.SALES_RETURN]: 'مردودات مبيعات',
  [AccountSubType.OTHER_REVENUE]: 'إيرادات أخرى',
  [AccountSubType.COGS]: 'تكلفة بضاعة مباعة',
  [AccountSubType.INVENTORY_ADJUSTMENT]: 'تسويات مخزون',
  [AccountSubType.OPERATING_EXPENSE]: 'مصروف تشغيلي',
  [AccountSubType.MANUFACTURING_EXPENSE]: 'مصروف صناعي',
  [AccountSubType.OTHER_EXPENSE]: 'مصروف آخر',
};

/** Which subtypes belong under each top-level account type (UI grouping). */
export const SUBTYPES_BY_TYPE: Record<AccountType, AccountSubType[]> = {
  [AccountType.ASSET]: [
    AccountSubType.CASH,
    AccountSubType.BANK,
    AccountSubType.ACCOUNTS_RECEIVABLE,
    AccountSubType.INVENTORY_RAW_MATERIAL,
    AccountSubType.INVENTORY_WIP,
    AccountSubType.INVENTORY_FINISHED_GOODS,
    AccountSubType.FIXED_ASSET,
    AccountSubType.TAX_RECEIVABLE,
  ],
  [AccountType.LIABILITY]: [
    AccountSubType.ACCOUNTS_PAYABLE,
    AccountSubType.TAX_PAYABLE,
    AccountSubType.SALARY_PAYABLE,
    AccountSubType.OTHER_PAYABLE,
  ],
  [AccountType.EQUITY]: [
    AccountSubType.CAPITAL,
    AccountSubType.RETAINED_EARNINGS,
    AccountSubType.OPENING_BALANCE_EQUITY,
  ],
  [AccountType.REVENUE]: [
    AccountSubType.SALES_REVENUE,
    AccountSubType.EXPORT_REVENUE,
    AccountSubType.SALES_RETURN,
    AccountSubType.OTHER_REVENUE,
  ],
  [AccountType.EXPENSE]: [
    AccountSubType.COGS,
    AccountSubType.INVENTORY_ADJUSTMENT,
    AccountSubType.OPERATING_EXPENSE,
    AccountSubType.MANUFACTURING_EXPENSE,
    AccountSubType.OTHER_EXPENSE,
  ],
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  [AccountType.ASSET]: 'الأصول',
  [AccountType.LIABILITY]: 'الخصوم',
  [AccountType.EQUITY]: 'حقوق الملكية',
  [AccountType.REVENUE]: 'الإيرادات',
  [AccountType.EXPENSE]: 'المصروفات',
};

export const ACCOUNT_NATURE_LABELS: Record<AccountNature, string> = {
  [AccountNature.DEBIT]: 'مدين',
  [AccountNature.CREDIT]: 'دائن',
};

/** Default normal side for each account type. */
export const DEFAULT_NATURE_BY_TYPE: Record<AccountType, AccountNature> = {
  [AccountType.ASSET]: AccountNature.DEBIT,
  [AccountType.EXPENSE]: AccountNature.DEBIT,
  [AccountType.LIABILITY]: AccountNature.CREDIT,
  [AccountType.EQUITY]: AccountNature.CREDIT,
  [AccountType.REVENUE]: AccountNature.CREDIT,
};
