/**
 * The master-data entities whose `code` can be system-generated. `key` is the
 * stable identifier stored in `code_settings` and used by the frontend forms;
 * `prefix` is the seeded default (editable per entity in settings).
 */
export interface CodeEntityDef {
  key: string;
  labelAr: string;
  prefix: string;
}

export const CODE_ENTITIES: CodeEntityDef[] = [
  { key: 'product', labelAr: 'المنتجات', prefix: 'PRD' },
  { key: 'customer', labelAr: 'العملاء', prefix: 'CUS' },
  { key: 'supplier', labelAr: 'الموردون', prefix: 'SUP' },
  { key: 'employee', labelAr: 'الموظفون', prefix: 'EMP' },
  { key: 'warehouse', labelAr: 'المخازن', prefix: 'WH' },
  { key: 'branch', labelAr: 'الفروع', prefix: 'BR' },
  { key: 'treasury', labelAr: 'الخزائن', prefix: 'TR' },
  { key: 'bank_account', labelAr: 'الحسابات البنكية', prefix: 'BNK' },
  { key: 'unit', labelAr: 'وحدات القياس', prefix: 'UNT' },
  { key: 'brand', labelAr: 'العلامات التجارية', prefix: 'BRD' },
  { key: 'product_category', labelAr: 'فئات المنتجات', prefix: 'CAT' },
];

export const CODE_ENTITY_KEYS = CODE_ENTITIES.map((e) => e.key);
