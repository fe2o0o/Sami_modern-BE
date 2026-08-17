import {
  AccountNature,
  AccountType,
} from '../../modules/chart-of-account/enums/account.enum';

/**
 * A node in the default chart-of-accounts template.
 *
 * The tree is intentionally declarative — structure only. The seeder's builder
 * derives everything else automatically:
 *  - `level`        from the depth in the tree (root = 1)
 *  - `parentId`     from the parent that was persisted just before
 *  - `accountType`  inherited from the nearest ancestor that declares one
 *  - `accountNature`from `nature`, else the default for the resolved type
 *  - `isHeader`     true when the node has children (a grouping account)
 *  - `allowPosting` true only for leaves (accounts that receive entries)
 *  - `accountSubType` mapped by code in the seeder (drives Settings dropdowns)
 *
 * `nature` is supplied only for contra accounts whose normal balance is opposite
 * to their type — none exist in this minimal template.
 */
export interface SeedAccountNode {
  code: string;
  nameAr: string;
  nameEn: string;
  /** Declared on roots; inherited by descendants when omitted. */
  type?: AccountType;
  /** Overrides the type's default normal side (contra accounts). Unused here. */
  nature?: AccountNature;
  description?: string;
  children?: SeedAccountNode[];
}

/**
 * Minimal default Chart of Accounts — six pillars, only the accounts the system
 * actually needs so Accounting Settings can be wired end-to-end out of the box:
 *
 *   1 الأصول · 2 الخصوم · 3 حقوق الملكية · 4 الإيرادات · 5 التكاليف · 6 المصاريف العمومية
 *
 * Code scheme (6 digits):
 *   X00000  root pillar        (level 1, header)
 *   XX0000  group              (level 2, header)
 *   XXX000  posting account    (leaf — receives journal lines)
 *
 * Every account referenced by the Accounting-Settings module exists here as a
 * posting leaf; {@link AccountingSettingSeeder} maps each setting to one by code.
 */
export const DEFAULT_CHART_OF_ACCOUNTS: SeedAccountNode[] = [
  // =====================================================================
  // 1 — ASSETS
  // =====================================================================
  {
    code: '100000',
    nameAr: 'الأصول',
    nameEn: 'Assets',
    type: AccountType.ASSET,
    children: [
      {
        code: '110000',
        nameAr: 'النقدية والبنوك',
        nameEn: 'Cash & Banks',
        children: [
          {
            code: '111000',
            nameAr: 'الخزينة (النقدية)',
            nameEn: 'Cash on Hand',
            description: 'الصندوق النقدي الرئيسي',
          },
          {
            code: '112000',
            nameAr: 'الحساب البنكي',
            nameEn: 'Bank Account',
            description: 'الحساب البنكي الرئيسي للشركة',
          },
        ],
      },
      {
        code: '120000',
        nameAr: 'العملاء والمدينون',
        nameEn: 'Receivables',
        children: [
          {
            code: '121000',
            nameAr: 'حساب مراقبة العملاء',
            nameEn: 'Customer Control',
            description: 'إجمالي أرصدة العملاء المدينة',
          },
          {
            code: '122000',
            nameAr: 'ض.ق.م على المشتريات (مدينة)',
            nameEn: 'Input VAT',
            description: 'ضريبة القيمة المضافة على المشتريات (قابلة للخصم)',
          },
        ],
      },
      {
        code: '130000',
        nameAr: 'المخزون',
        nameEn: 'Inventory',
        children: [
          {
            code: '131000',
            nameAr: 'مخزون المواد الخام',
            nameEn: 'Raw Material Inventory',
          },
          {
            code: '132000',
            nameAr: 'مخزون تحت التشغيل',
            nameEn: 'Work In Progress',
          },
          {
            code: '133000',
            nameAr: 'مخزون المنتج التام',
            nameEn: 'Finished Goods Inventory',
          },
        ],
      },
    ],
  },

  // =====================================================================
  // 2 — LIABILITIES
  // =====================================================================
  {
    code: '200000',
    nameAr: 'الخصوم',
    nameEn: 'Liabilities',
    type: AccountType.LIABILITY,
    children: [
      {
        code: '210000',
        nameAr: 'الموردون والدائنون',
        nameEn: 'Payables',
        children: [
          {
            code: '211000',
            nameAr: 'حساب مراقبة الموردين',
            nameEn: 'Supplier Control',
            description: 'إجمالي أرصدة الموردين الدائنة',
          },
        ],
      },
      {
        code: '220000',
        nameAr: 'التزامات ضريبية',
        nameEn: 'Tax Liabilities',
        children: [
          {
            code: '221000',
            nameAr: 'ض.ق.م على المبيعات (دائنة)',
            nameEn: 'Output VAT',
            description: 'ضريبة القيمة المضافة المستحقة على المبيعات',
          },
        ],
      },
      {
        code: '230000',
        nameAr: 'التزامات أخرى',
        nameEn: 'Other Liabilities',
        children: [
          {
            code: '231000',
            nameAr: 'عمولات مستحقة الدفع',
            nameEn: 'Commissions Payable',
            description: 'عمولات المندوبين المستحقة',
          },
        ],
      },
    ],
  },

  // =====================================================================
  // 3 — EQUITY
  // =====================================================================
  {
    code: '300000',
    nameAr: 'حقوق الملكية',
    nameEn: 'Equity',
    type: AccountType.EQUITY,
    children: [
      {
        code: '310000',
        nameAr: 'رأس المال',
        nameEn: 'Capital',
        description: 'رأس المال المدفوع',
      },
      {
        code: '320000',
        nameAr: 'الأرباح المرحلة',
        nameEn: 'Retained Earnings',
        description: 'الأرباح المحتجزة من السنوات السابقة',
      },
      {
        code: '330000',
        nameAr: 'حساب موازنة الأرصدة الافتتاحية',
        nameEn: 'Opening Balance Equity',
        description: 'حساب موازنة تلقائي للأرصدة الافتتاحية',
      },
    ],
  },

  // =====================================================================
  // 4 — REVENUE
  // =====================================================================
  {
    code: '400000',
    nameAr: 'الإيرادات',
    nameEn: 'Revenue',
    type: AccountType.REVENUE,
    children: [
      {
        code: '410000',
        nameAr: 'إيرادات المبيعات',
        nameEn: 'Sales Revenue',
        description: 'إيرادات بيع البضاعة والمنتجات',
      },
    ],
  },

  // =====================================================================
  // 5 — COSTS
  // =====================================================================
  {
    code: '500000',
    nameAr: 'التكاليف',
    nameEn: 'Costs',
    type: AccountType.EXPENSE,
    children: [
      {
        code: '510000',
        nameAr: 'تكلفة البضاعة المباعة',
        nameEn: 'Cost of Goods Sold',
        description: 'تكلفة البضاعة والمنتجات المباعة',
      },
    ],
  },

  // =====================================================================
  // 6 — GENERAL & ADMINISTRATIVE EXPENSES
  // =====================================================================
  {
    code: '600000',
    nameAr: 'المصاريف العمومية والإدارية',
    nameEn: 'General & Administrative Expenses',
    type: AccountType.EXPENSE,
    children: [
      {
        code: '610000',
        nameAr: 'مصروفات عمومية وإدارية',
        nameEn: 'Operating Expenses',
        children: [
          {
            code: '611000',
            nameAr: 'مصروفات تشغيلية عامة',
            nameEn: 'General Operating Expense',
            description: 'الإيجار، المرافق، الرواتب، وغيرها من المصروفات التشغيلية',
          },
          {
            code: '612000',
            nameAr: 'تسويات وعجز المخزون',
            nameEn: 'Inventory Adjustment',
            description: 'فروق وتسويات جرد المخزون',
          },
          {
            code: '613000',
            nameAr: 'عمولات المندوبين',
            nameEn: 'Sales Commissions',
            description: 'مصروف عمولات مندوبي المبيعات',
          },
        ],
      },
    ],
  },
];
