/**
 * The master-data entities whose `code` can be system-generated. `key` is the
 * stable identifier stored in `code_settings` and used by the frontend forms;
 * `prefix` is the seeded default (editable per entity in settings).
 */
export interface CodeEntityDef {
  key: string;
  labelAr: string;
  prefix: string;
  /** Table holding the records — a generated code skips numbers already used there. */
  table: string;
}

export const CODE_ENTITIES: CodeEntityDef[] = [
  { key: 'product', labelAr: 'المنتجات', prefix: 'PRD', table: 'products' },
  { key: 'customer', labelAr: 'العملاء', prefix: 'CUS', table: 'customers' },
  { key: 'supplier', labelAr: 'الموردون', prefix: 'SUP', table: 'suppliers' },
  { key: 'employee', labelAr: 'الموظفون', prefix: 'EMP', table: 'employees' },
  { key: 'warehouse', labelAr: 'المخازن', prefix: 'WH', table: 'warehouses' },
  { key: 'branch', labelAr: 'الفروع', prefix: 'BR', table: 'branches' },
  { key: 'treasury', labelAr: 'الخزائن', prefix: 'TR', table: 'treasuries' },
  { key: 'bank_account', labelAr: 'الحسابات البنكية', prefix: 'BNK', table: 'bank_accounts' },
  { key: 'unit', labelAr: 'وحدات القياس', prefix: 'UNT', table: 'units' },
  { key: 'brand', labelAr: 'العلامات التجارية', prefix: 'BRD', table: 'brands' },
  { key: 'product_category', labelAr: 'فئات المنتجات', prefix: 'CAT', table: 'product_categories' },
  { key: 'department', labelAr: 'الأقسام', prefix: 'DEP', table: 'departments' },
  { key: 'job_grade', labelAr: 'الدرجات الوظيفية', prefix: 'GRD', table: 'job_grades' },
  { key: 'pay_component', labelAr: 'بنود الراتب', prefix: 'PAY', table: 'pay_components' },
];

export const CODE_ENTITY_KEYS = CODE_ENTITIES.map((e) => e.key);
