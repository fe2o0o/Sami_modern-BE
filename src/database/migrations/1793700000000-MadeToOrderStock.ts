import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «مصنّع لعملاء»: a product manufactured for a customer's order is held in its
 * warehouse in a SEPARATE balance (`warehouse_stock.mto_quantity / mto_value`) —
 * visible, but never available for sale and never part of the weighted average —
 * and leaves at its own order cost. Orders and delivery lines track how much of it
 * they hold / delivered. Additive only.
 */
export class MadeToOrderStock1793700000000 implements MigrationInterface {
  name = 'MadeToOrderStock1793700000000';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('warehouse_stock', 'mto_quantity'))) {
      await q.query('ALTER TABLE `warehouse_stock` ADD `mto_quantity` decimal(18,3) NOT NULL DEFAULT 0');
      await q.query('ALTER TABLE `warehouse_stock` ADD `mto_value` decimal(18,2) NOT NULL DEFAULT 0');
    }
    if (!(await q.hasColumn('stock_movements', 'made_to_order'))) {
      await q.query('ALTER TABLE `stock_movements` ADD `made_to_order` tinyint NOT NULL DEFAULT 0');
    }
    if (!(await q.hasColumn('manufacturing_orders', 'to_order_quantity'))) {
      await q.query('ALTER TABLE `manufacturing_orders` ADD `to_order_quantity` decimal(18,3) NOT NULL DEFAULT 0');
    }
    if (!(await q.hasColumn('sales_delivery_items', 'mto_delivered_quantity'))) {
      await q.query('ALTER TABLE `sales_delivery_items` ADD `mto_delivered_quantity` decimal(18,3) NOT NULL DEFAULT 0');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE `sales_delivery_items` DROP COLUMN `mto_delivered_quantity`');
    await q.query('ALTER TABLE `manufacturing_orders` DROP COLUMN `to_order_quantity`');
    await q.query('ALTER TABLE `stock_movements` DROP COLUMN `made_to_order`');
    await q.query('ALTER TABLE `warehouse_stock` DROP COLUMN `mto_value`');
    await q.query('ALTER TABLE `warehouse_stock` DROP COLUMN `mto_quantity`');
  }
}
