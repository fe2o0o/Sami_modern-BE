import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A delivery order / invoice whose goods were ALL returned before anything was
 * delivered showed «تم التسليم» (a closed quantity counted as delivered). New
 * state `cancelled` («ملغى بالمرتجع») for both, and existing documents in that
 * situation (e.g. a manufacturing line closed by «إلغاء الصنف») are re-labelled.
 * Status labels only — no quantities, stock or journals are touched.
 */
export class DeliveryCancelledState1791700000000 implements MigrationInterface {
  name = 'DeliveryCancelledState1791700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`sales_deliveries\` MODIFY \`delivery_progress\` enum ('pending','partial','delivered','cancelled') NOT NULL DEFAULT 'pending'`);
    await q.query(`ALTER TABLE \`sales_invoices\` MODIFY \`delivery_status\` enum ('not_applicable','pending','partial','delivered','cancelled') NOT NULL DEFAULT 'pending'`);

    await q.query(`
      UPDATE \`sales_deliveries\` d SET d.\`delivery_progress\` = 'cancelled'
       WHERE d.\`source\` = 'invoice' AND d.\`status\` <> 'reversed' AND d.\`deleted_at\` IS NULL
         AND EXISTS (SELECT 1 FROM \`sales_delivery_items\` i WHERE i.\`sales_delivery_id\` = d.\`id\` AND i.\`deleted_at\` IS NULL AND i.\`line_type\` <> 'service')
         AND NOT EXISTS (SELECT 1 FROM \`sales_delivery_items\` i WHERE i.\`sales_delivery_id\` = d.\`id\` AND i.\`deleted_at\` IS NULL AND i.\`line_type\` <> 'service'
                           AND (i.\`delivered_quantity\` > 0.000001 OR i.\`delivered_quantity\` + i.\`cancelled_quantity\` < i.\`ordered_quantity\` - 0.000001))`);

    await q.query(`
      UPDATE \`sales_invoices\` si SET si.\`delivery_status\` = 'cancelled'
       WHERE si.\`status\` = 'posted' AND si.\`deleted_at\` IS NULL
         AND EXISTS (SELECT 1 FROM \`sales_invoice_items\` ii WHERE ii.\`sales_invoice_id\` = si.\`id\` AND ii.\`deleted_at\` IS NULL AND ii.\`line_type\` <> 'service')
         AND NOT EXISTS (SELECT 1 FROM \`sales_invoice_items\` ii WHERE ii.\`sales_invoice_id\` = si.\`id\` AND ii.\`deleted_at\` IS NULL AND ii.\`line_type\` <> 'service'
                           AND (ii.\`delivered_quantity\` > 0.000001
                                OR ii.\`quantity\` - COALESCE((SELECT SUM(di.\`cancelled_quantity\`) FROM \`sales_delivery_items\` di
                                                              WHERE di.\`sales_invoice_item_id\` = ii.\`id\` AND di.\`deleted_at\` IS NULL), 0) > 0.000001))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE \`sales_deliveries\` SET \`delivery_progress\` = 'delivered' WHERE \`delivery_progress\` = 'cancelled'`);
    await q.query(`UPDATE \`sales_invoices\` SET \`delivery_status\` = 'delivered' WHERE \`delivery_status\` = 'cancelled'`);
    await q.query(`ALTER TABLE \`sales_deliveries\` MODIFY \`delivery_progress\` enum ('pending','partial','delivered') NOT NULL DEFAULT 'pending'`);
    await q.query(`ALTER TABLE \`sales_invoices\` MODIFY \`delivery_status\` enum ('not_applicable','pending','partial','delivered') NOT NULL DEFAULT 'pending'`);
  }
}
