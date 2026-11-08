import { EntityManager, In } from 'typeorm';
import { Product } from '../product/entities/product.entity';
import { WarehouseStock } from '../stock/entities/warehouse-stock.entity';

/** Where a product's sale cost comes from (same chain as the cost booked with the invoice). */
export type UnitCostSource = 'warehouse_avg' | 'all_stock_avg' | 'product_card' | 'none';

export interface UnitCost {
  cost: number;
  source: UnitCostSource;
}

/**
 * Unit cost of each product as the invoice will book it: the average cost in
 * the line's warehouse → the quantity-weighted average of every warehouse with
 * stock → the cost price on the product card. 0 / 'none' = the product has no
 * cost anywhere (a stock line for it is refused until a cost is set).
 */
export async function unitCostsOf(
  manager: EntityManager,
  productIds: string[],
  warehouseId: string | null,
): Promise<Map<string, UnitCost>> {
  const ids = [...new Set(productIds)];
  const out = new Map<string, UnitCost>();
  if (!ids.length) return out;
  const [inWarehouse, allStock, products] = await Promise.all([
    warehouseId ? manager.getRepository(WarehouseStock).find({ where: { warehouseId, productId: In(ids) } }) : Promise.resolve([] as WarehouseStock[]),
    manager.query(
      `SELECT product_id AS id, COALESCE(SUM(quantity * avg_cost) / NULLIF(SUM(quantity), 0), 0) AS c
         FROM warehouse_stock WHERE product_id IN (?) AND quantity > 0 AND deleted_at IS NULL GROUP BY product_id`,
      [ids],
    ) as Promise<Array<{ id: string; c: string | null }>>,
    manager.getRepository(Product).find({ where: { id: In(ids) }, select: { id: true, costPrice: true }, withDeleted: true }),
  ]);
  const wh = new Map(inWarehouse.map((s) => [s.productId, Number(s.avgCost) || 0]));
  const all = new Map(allStock.map((r) => [r.id, Number(r.c) || 0]));
  const card = new Map(products.map((p) => [p.id, Number(p.costPrice) || 0]));
  for (const id of ids) {
    if ((wh.get(id) ?? 0) > 0) out.set(id, { cost: wh.get(id)!, source: 'warehouse_avg' });
    else if ((all.get(id) ?? 0) > 0) out.set(id, { cost: all.get(id)!, source: 'all_stock_avg' });
    else if ((card.get(id) ?? 0) > 0) out.set(id, { cost: card.get(id)!, source: 'product_card' });
    else out.set(id, { cost: 0, source: 'none' });
  }
  return out;
}

/** The stock lines whose product has no cost at all — «المنتج «X» مالوش تكلفة». */
export async function stockLinesWithoutCost<T extends { productId: string; warehouseId?: string | null; productName?: string | null }>(
  manager: EntityManager,
  lines: T[],
): Promise<T[]> {
  const byWarehouse = new Map<string, T[]>();
  for (const l of lines) {
    const k = l.warehouseId ?? '';
    byWarehouse.set(k, [...(byWarehouse.get(k) ?? []), l]);
  }
  const missing: T[] = [];
  for (const [wh, group] of byWarehouse) {
    const costs = await unitCostsOf(manager, group.map((l) => l.productId), wh || null);
    missing.push(...group.filter((l) => (costs.get(l.productId)?.cost ?? 0) <= 0));
  }
  return missing;
}

export function noCostMessage(names: string[]): string {
  return `${names.length > 1 ? 'المنتجات' : 'المنتج'} «${names.join('»، «')}» ${names.length > 1 ? 'مالهاش' : 'مالوش'} تكلفة — حدد التكلفة قبل البيع من المخزن`;
}
