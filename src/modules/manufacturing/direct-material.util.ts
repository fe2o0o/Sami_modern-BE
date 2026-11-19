import { EntityManager } from 'typeorm';
import { ProductType } from '../product/enums/product-type.enum';
import { ManufacturingOrderStatus } from './enums/manufacturing.enum';

/**
 * Raw material bought STRAIGHT onto a manufacturing order (a purchase-invoice line
 * that names the order). It never enters a warehouse and is never averaged: its exact
 * net cost (after discount, before VAT) is part of the order's product cost.
 *
 * Read-only helpers shared by purchases, purchase returns and manufacturing. The
 * figures are always recomputed from the documents (posted purchases − their posted
 * returns), never kept as a running total that could drift.
 */

/** Only these product types can be bought straight onto an order. */
export const DIRECT_MATERIAL_TYPES: string[] = [ProductType.RAW_MATERIAL, ProductType.SEMI_FINISHED];

/** An order takes direct material only before production. */
export const DIRECT_MATERIAL_OPEN_STATUSES: string[] = [ManufacturingOrderStatus.NEW, ManufacturingOrderStatus.IN_PROGRESS];

export interface DirectMaterialLine {
  purchaseInvoiceItemId: string;
  purchaseInvoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  supplierId: string;
  supplierName: string | null;
  /** The purchase invoice's warehouse — default home of the material if the order is cancelled. */
  invoiceWarehouseId: string;
  productId: string;
  productName: string | null;
  unitName: string | null;
  description: string | null;
  quantity: number;
  returnedQuantity: number;
  /** Net cost still on the order = line net − net of its posted returns. */
  netCost: number;
  unitCost: number;
  releasedWarehouseId: string | null;
  releasedWarehouseName: string | null;
  releasedAt: Date | null;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const r3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;

/** Every POSTED purchase line bought onto the order, with what was returned of it. */
export async function directMaterialLinesOf(manager: EntityManager, orderId: string): Promise<DirectMaterialLine[]> {
  const returned = (col: string) =>
    `COALESCE((SELECT SUM(ri.${col}) FROM purchase_return_items ri
                 JOIN purchase_returns r ON r.id = ri.purchase_return_id
                WHERE ri.purchase_invoice_item_id = i.id AND r.status = 'posted'
                  AND r.deleted_at IS NULL AND ri.deleted_at IS NULL), 0)`;
  const rows = (await manager.query(
    `SELECT i.id, i.purchase_invoice_id AS invoiceId, pi.invoice_number AS invoiceNumber,
            DATE_FORMAT(pi.invoice_date, '%Y-%m-%d') AS invoiceDate, pi.supplier_id AS supplierId, s.name AS supplierName,
            pi.warehouse_id AS invoiceWarehouseId, i.product_id AS productId, i.product_name AS productName,
            i.unit_name AS unitName, i.direct_description AS description, i.quantity, i.net_before_tax AS net,
            i.unit_cost_at_post AS unitCost, i.released_warehouse_id AS releasedWarehouseId, w.name AS releasedWarehouseName,
            i.released_at AS releasedAt, ${returned('quantity')} AS rq, ${returned('net_before_tax')} AS rnet
       FROM purchase_invoice_items i
       JOIN purchase_invoices pi ON pi.id = i.purchase_invoice_id
       LEFT JOIN suppliers s ON s.id = pi.supplier_id
       LEFT JOIN warehouses w ON w.id = i.released_warehouse_id
      WHERE i.manufacturing_order_id = ? AND pi.status = 'posted' AND pi.deleted_at IS NULL AND i.deleted_at IS NULL
      ORDER BY pi.invoice_date, pi.invoice_number, i.line_number`,
    [orderId],
  )) as Array<Record<string, string | null>>;
  return rows.map((r) => {
    const qty = Number(r.quantity) || 0;
    return {
      purchaseInvoiceItemId: r.id!,
      purchaseInvoiceId: r.invoiceId!,
      invoiceNumber: r.invoiceNumber ?? null,
      invoiceDate: r.invoiceDate!,
      supplierId: r.supplierId!,
      supplierName: r.supplierName ?? null,
      invoiceWarehouseId: r.invoiceWarehouseId!,
      productId: r.productId!,
      productName: r.productName ?? null,
      unitName: r.unitName ?? null,
      description: r.description ?? null,
      quantity: qty,
      returnedQuantity: r3(Number(r.rq) || 0),
      netCost: r2((Number(r.net) || 0) - (Number(r.rnet) || 0)),
      unitCost: Number(r.unitCost) || (qty > 0 ? r2((Number(r.net) || 0) / qty) : 0),
      releasedWarehouseId: r.releasedWarehouseId ?? null,
      releasedWarehouseName: r.releasedWarehouseName ?? null,
      releasedAt: r.releasedAt ? new Date(r.releasedAt) : null,
    };
  });
}

/** The order's direct material cost: posted purchases − their posted returns, at net cost. */
export async function directMaterialCostOf(manager: EntityManager, orderId: string): Promise<number> {
  const lines = await directMaterialLinesOf(manager, orderId);
  return r2(lines.reduce((s, l) => s + l.netCost, 0));
}
