import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Raw material bought straight onto a manufacturing order (e.g. the fabric a customer
 * picked): a purchase-invoice line can name the order it is for. Such a line never
 * enters a warehouse — its exact net cost goes onto the order (`direct_material_cost`).
 * If the order is cancelled, what is left of the material is moved into a warehouse
 * (`released_warehouse_id` / `released_at`). Additive only — no existing data changes.
 */
export class DirectMaterialToManufacturingOrder1793400000000 implements MigrationInterface {
  name = 'DirectMaterialToManufacturingOrder1793400000000';

  public async up(q: QueryRunner): Promise<void> {
    const t = 'purchase_invoice_items';
    if (!(await q.hasColumn(t, 'manufacturing_order_id'))) {
      await q.query(`ALTER TABLE \`${t}\` ADD \`manufacturing_order_id\` varchar(36) NULL`);
      await q.query(`CREATE INDEX \`IDX_purchase_invoice_items_mo\` ON \`${t}\` (\`manufacturing_order_id\`)`);
    }
    if (!(await q.hasColumn(t, 'direct_description'))) {
      await q.query(`ALTER TABLE \`${t}\` ADD \`direct_description\` varchar(255) NULL`);
    }
    if (!(await q.hasColumn(t, 'released_warehouse_id'))) {
      await q.query(`ALTER TABLE \`${t}\` ADD \`released_warehouse_id\` varchar(36) NULL`);
    }
    if (!(await q.hasColumn(t, 'released_at'))) {
      await q.query(`ALTER TABLE \`${t}\` ADD \`released_at\` datetime NULL`);
    }
    if (!(await q.hasColumn('manufacturing_orders', 'direct_material_cost'))) {
      await q.query('ALTER TABLE `manufacturing_orders` ADD `direct_material_cost` decimal(18,2) NOT NULL DEFAULT 0');
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasColumn('manufacturing_orders', 'direct_material_cost')) {
      await q.query('ALTER TABLE `manufacturing_orders` DROP COLUMN `direct_material_cost`');
    }
    const t = 'purchase_invoice_items';
    for (const c of ['released_at', 'released_warehouse_id', 'direct_description']) {
      if (await q.hasColumn(t, c)) await q.query(`ALTER TABLE \`${t}\` DROP COLUMN \`${c}\``);
    }
    if (await q.hasColumn(t, 'manufacturing_order_id')) {
      await q.query(`DROP INDEX \`IDX_purchase_invoice_items_mo\` ON \`${t}\``);
      await q.query(`ALTER TABLE \`${t}\` DROP COLUMN \`manufacturing_order_id\``);
    }
  }
}
