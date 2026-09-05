/**
 * The single source of truth for every permission the system recognises.
 *
 * A permission key is `<module>.<action>` (e.g. `sales_invoices.post`). The
 * catalog is defined in code — not the database — so it is versioned with the
 * app and drives both the backend guard and the frontend permission matrix.
 * A `role_permissions` row simply stores one granted key per role.
 */

export enum PermissionAction {
  VIEW = 'view',
  CREATE = 'create',
  EDIT = 'edit',
  DELETE = 'delete',
  POST = 'post',
  REVERSE = 'reverse',
  MANAGE = 'manage',
}

export const PERMISSION_ACTION_LABELS: Record<PermissionAction, string> = {
  [PermissionAction.VIEW]: 'عرض',
  [PermissionAction.CREATE]: 'إنشاء',
  [PermissionAction.EDIT]: 'تعديل',
  [PermissionAction.DELETE]: 'حذف',
  [PermissionAction.POST]: 'ترحيل',
  [PermissionAction.REVERSE]: 'عكس',
  [PermissionAction.MANAGE]: 'إدارة',
};

export interface PermissionModuleDef {
  /** Stable module key — the first half of every permission key. */
  module: string;
  labelAr: string;
  actions: PermissionAction[];
}

export interface PermissionGroupDef {
  group: string;
  labelAr: string;
  modules: PermissionModuleDef[];
}

const A = PermissionAction;
/** Full document lifecycle (draft CRUD → post → reverse). */
const DOC = [A.VIEW, A.CREATE, A.EDIT, A.DELETE, A.POST, A.REVERSE];
/** Plain master record (no posting). */
const CRUD = [A.VIEW, A.CREATE, A.EDIT, A.DELETE];

export const PERMISSION_CATALOG: PermissionGroupDef[] = [
  {
    group: 'operations',
    labelAr: 'العمليات',
    modules: [
      { module: 'sales_invoices', labelAr: 'فواتير المبيعات', actions: DOC },
      { module: 'sales_deliveries', labelAr: 'أذون التسليم', actions: DOC },
      { module: 'sales_returns', labelAr: 'مردودات المبيعات', actions: DOC },
      { module: 'purchase_invoices', labelAr: 'فواتير المشتريات', actions: DOC },
      { module: 'purchase_returns', labelAr: 'مردودات المشتريات', actions: DOC },
      { module: 'vouchers', labelAr: 'سندات القبض والصرف', actions: DOC },
      { module: 'manufacturing', labelAr: 'أوامر التصنيع', actions: DOC },
    ],
  },
  {
    group: 'inventory',
    labelAr: 'المخزون',
    modules: [
      { module: 'stock', labelAr: 'أرصدة وحركات المخزون', actions: [A.VIEW] },
      { module: 'inventory_adjustments', labelAr: 'تسويات المخزون', actions: DOC },
      { module: 'stock_transfers', labelAr: 'التحويلات بين المخازن', actions: DOC },
    ],
  },
  {
    group: 'master_data',
    labelAr: 'البيانات الأساسية',
    modules: [
      { module: 'products', labelAr: 'المنتجات', actions: CRUD },
      { module: 'customers', labelAr: 'العملاء', actions: CRUD },
      { module: 'suppliers', labelAr: 'الموردون', actions: CRUD },
      { module: 'employees', labelAr: 'الموظفون', actions: CRUD },
      { module: 'product_catalog', labelAr: 'الوحدات والعلامات والفئات', actions: [A.VIEW, A.MANAGE] },
    ],
  },
  {
    group: 'accounting',
    labelAr: 'المحاسبة والتقارير',
    modules: [
      { module: 'journal_entries', labelAr: 'القيود اليومية', actions: DOC },
      { module: 'opening_balances', labelAr: 'الأرصدة الافتتاحية', actions: [A.VIEW, A.CREATE, A.EDIT, A.POST] },
      { module: 'chart_of_accounts', labelAr: 'شجرة الحسابات', actions: CRUD },
      { module: 'accounting_reports', labelAr: 'التقارير المالية', actions: [A.VIEW] },
      { module: 'accounting_settings', labelAr: 'إعدادات المحاسبة', actions: [A.VIEW, A.EDIT] },
      { module: 'code_settings', labelAr: 'إعدادات توليد الأكواد', actions: [A.VIEW, A.EDIT] },
    ],
  },
  {
    group: 'administration',
    labelAr: 'الإعدادات والإدارة',
    modules: [
      { module: 'company', labelAr: 'بيانات الشركة', actions: [A.VIEW, A.EDIT] },
      { module: 'branches', labelAr: 'الفروع', actions: [A.VIEW, A.MANAGE] },
      { module: 'warehouses', labelAr: 'المخازن', actions: [A.VIEW, A.MANAGE] },
      { module: 'treasuries', labelAr: 'الخزائن', actions: [A.VIEW, A.MANAGE] },
      { module: 'bank_accounts', labelAr: 'الحسابات البنكية', actions: [A.VIEW, A.MANAGE] },
      { module: 'fiscal_years', labelAr: 'السنوات المالية والفترات', actions: [A.VIEW, A.MANAGE] },
      { module: 'users', labelAr: 'المستخدمون', actions: CRUD },
      { module: 'roles', labelAr: 'الأدوار والصلاحيات', actions: CRUD },
      // Data-scope override: holders see data across ALL branches instead of
      // being restricted to their own branch. ADMIN bypasses this implicitly.
      { module: 'all_branches', labelAr: 'الوصول لبيانات كل الفروع', actions: [A.VIEW] },
    ],
  },
];

/** Every valid permission key, flattened from the catalog. */
export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.flatMap((g) =>
  g.modules.flatMap((m) => m.actions.map((a) => `${m.module}.${a}`)),
);

const PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);

/** True when `key` is a recognised `<module>.<action>` permission. */
export function isValidPermissionKey(key: string): boolean {
  return PERMISSION_KEY_SET.has(key);
}

/** Filter an arbitrary list down to the keys that exist in the catalog. */
export function sanitizePermissionKeys(keys: string[]): string[] {
  return [...new Set(keys)].filter((k) => PERMISSION_KEY_SET.has(k));
}
