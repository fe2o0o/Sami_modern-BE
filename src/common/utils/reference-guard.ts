import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Where a master record (customer / supplier / product / unit) can be referenced.
 * Only LIVE rows count: soft-deleted rows (and lines whose parent document was
 * soft-deleted, e.g. a deleted draft) never block a delete.
 */
export interface ReferenceSpec {
  /** Arabic label used in the refusal message, e.g. «فواتير مبيعات». */
  label: string;
  table: string;
  column: string;
  /** Extra fixed condition on the referencing row (static SQL, no user input). */
  where?: string;
  /** For line tables: the parent document must itself be live. */
  parent?: { table: string; fk: string };
}

/**
 * Throws a friendly 400 listing where the record is still used. Read-only —
 * it never changes data, so records already deleted stay exactly as they are.
 */
export async function assertNotReferenced(
  db: Pick<DataSource | EntityManager, 'query'>,
  id: string,
  specs: ReferenceSpec[],
  what: string,
): Promise<void> {
  const hits: string[] = [];
  for (const s of specs) {
    const join = s.parent ? ` INNER JOIN \`${s.parent.table}\` p ON p.id = r.\`${s.parent.fk}\` AND p.deleted_at IS NULL` : '';
    const extra = s.where ? ` AND (${s.where})` : '';
    const sql = `SELECT COUNT(*) AS n FROM \`${s.table}\` r${join} WHERE r.\`${s.column}\` = ? AND r.deleted_at IS NULL${extra}`;
    const rows = (await db.query(sql, [id])) as Array<{ n: number | string }>;
    const n = Number(rows[0]?.n ?? 0);
    if (n > 0) hits.push(`${s.label} (${n})`);
  }
  if (hits.length) {
    throw new BadRequestException(
      `لا يمكن حذف ${what} لأنه مستخدم في: ${hits.join('، ')}. يمكنك إيقافه (غير نشط) بدلاً من الحذف للحفاظ على السجلات.`,
    );
  }
}

export const CUSTOMER_REFERENCES: ReferenceSpec[] = [
  { label: 'فواتير مبيعات', table: 'sales_invoices', column: 'customer_id' },
  { label: 'مردودات مبيعات', table: 'sales_returns', column: 'customer_id' },
  { label: 'أذون تسليم', table: 'sales_deliveries', column: 'customer_id' },
  { label: 'سندات', table: 'vouchers', column: 'party_id', where: "r.party_type = 'customer'" },
  { label: 'أوامر تصنيع', table: 'manufacturing_orders', column: 'customer_id' },
  { label: 'حركات كشف الحساب', table: 'customer_transactions', column: 'customer_id' },
  { label: 'قيود يومية', table: 'journal_entry_lines', column: 'customer_id', parent: { table: 'journal_entries', fk: 'journal_entry_id' } },
  { label: 'أرصدة افتتاحية', table: 'opening_balance_details', column: 'customer_id', parent: { table: 'opening_balances', fk: 'opening_balance_id' } },
];

export const SUPPLIER_REFERENCES: ReferenceSpec[] = [
  { label: 'فواتير مشتريات', table: 'purchase_invoices', column: 'supplier_id' },
  { label: 'مردودات مشتريات', table: 'purchase_returns', column: 'supplier_id' },
  { label: 'سندات', table: 'vouchers', column: 'party_id', where: "r.party_type = 'supplier'" },
  { label: 'أوامر تصنيع (كمصنع)', table: 'manufacturing_orders', column: 'factory_supplier_id' },
  { label: 'أصناف تصنيع في فواتير مبيعات', table: 'sales_invoice_items', column: 'factory_supplier_id', parent: { table: 'sales_invoices', fk: 'sales_invoice_id' } },
  { label: 'حركات كشف الحساب', table: 'supplier_transactions', column: 'supplier_id' },
  { label: 'قيود يومية', table: 'journal_entry_lines', column: 'supplier_id', parent: { table: 'journal_entries', fk: 'journal_entry_id' } },
  { label: 'أرصدة افتتاحية', table: 'opening_balance_details', column: 'supplier_id', parent: { table: 'opening_balances', fk: 'opening_balance_id' } },
];

export const PRODUCT_REFERENCES: ReferenceSpec[] = [
  { label: 'رصيد في المخازن', table: 'warehouse_stock', column: 'product_id', where: 'r.quantity <> 0 OR r.reserved_quantity <> 0' },
  { label: 'حركات مخزون', table: 'stock_movements', column: 'product_id' },
  { label: 'فواتير مبيعات', table: 'sales_invoice_items', column: 'product_id', parent: { table: 'sales_invoices', fk: 'sales_invoice_id' } },
  { label: 'مكوّنات تصنيع في فواتير مبيعات', table: 'sales_invoice_item_components', column: 'component_product_id', parent: { table: 'sales_invoice_items', fk: 'sales_invoice_item_id' } },
  { label: 'فواتير مشتريات', table: 'purchase_invoice_items', column: 'product_id', parent: { table: 'purchase_invoices', fk: 'purchase_invoice_id' } },
  { label: 'مردودات مشتريات', table: 'purchase_return_items', column: 'product_id', parent: { table: 'purchase_returns', fk: 'purchase_return_id' } },
  { label: 'مردودات مبيعات', table: 'sales_return_items', column: 'product_id', parent: { table: 'sales_returns', fk: 'sales_return_id' } },
  { label: 'أذون تسليم', table: 'sales_delivery_items', column: 'product_id', parent: { table: 'sales_deliveries', fk: 'sales_delivery_id' } },
  { label: 'تسويات مخزنية', table: 'inventory_adjustment_items', column: 'product_id', parent: { table: 'inventory_adjustments', fk: 'inventory_adjustment_id' } },
  { label: 'تحويلات مخزنية', table: 'stock_transfer_items', column: 'product_id', parent: { table: 'stock_transfers', fk: 'stock_transfer_id' } },
  { label: 'أوامر تصنيع', table: 'manufacturing_orders', column: 'product_id' },
  { label: 'مكوّنات أوامر تصنيع', table: 'manufacturing_order_components', column: 'component_product_id', parent: { table: 'manufacturing_orders', fk: 'manufacturing_order_id' } },
  { label: 'مكوّنات منتجات أخرى', table: 'product_components', column: 'component_product_id', parent: { table: 'products', fk: 'parent_product_id' } },
  { label: 'أرصدة افتتاحية', table: 'opening_balance_details', column: 'product_id', parent: { table: 'opening_balances', fk: 'opening_balance_id' } },
];

export const UNIT_REFERENCES: ReferenceSpec[] = [
  { label: 'منتجات', table: 'products', column: 'unit_id' },
  { label: 'فواتير مبيعات', table: 'sales_invoice_items', column: 'unit_id', parent: { table: 'sales_invoices', fk: 'sales_invoice_id' } },
  { label: 'فواتير مشتريات', table: 'purchase_invoice_items', column: 'unit_id', parent: { table: 'purchase_invoices', fk: 'purchase_invoice_id' } },
  { label: 'مردودات مشتريات', table: 'purchase_return_items', column: 'unit_id', parent: { table: 'purchase_returns', fk: 'purchase_return_id' } },
  { label: 'مردودات مبيعات', table: 'sales_return_items', column: 'unit_id', parent: { table: 'sales_returns', fk: 'sales_return_id' } },
  { label: 'أذون تسليم', table: 'sales_delivery_items', column: 'unit_id', parent: { table: 'sales_deliveries', fk: 'sales_delivery_id' } },
];
