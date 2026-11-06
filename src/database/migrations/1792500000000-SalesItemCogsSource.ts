import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where the cost booked with an invoice line came from, so reports can say
 * «تقديري — متوسط المخزن / كارت المنتج / أمر التصنيع…» instead of just
 * «تقديرية». Set at posting from now on. Older lines get it only where it is
 * certain: quick-sale lines (issued from stock at posting) and manufacturing
 * lines (components + factory fee); other old lines stay unknown (NULL).
 */
export class SalesItemCogsSource1792500000000 implements MigrationInterface {
  name = 'SalesItemCogsSource1792500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`sales_invoice_items\` ADD \`cogs_source\` varchar(30) NULL`);
    await q.query(`
      UPDATE \`sales_invoice_items\` i
        JOIN \`sales_invoices\` s ON s.\`id\` = i.\`sales_invoice_id\`
         SET i.\`cogs_source\` = 'stock_issue'
       WHERE s.\`is_quick_sale\` = 1 AND i.\`cogs_accrued\` > 0`);
    // no bill of materials (neither on the line nor on the product) → the factory fee only
    await q.query(`
      UPDATE \`sales_invoice_items\` i
         SET i.\`cogs_source\` = CASE
           WHEN NOT EXISTS (SELECT 1 FROM \`sales_invoice_item_components\` c WHERE c.\`sales_invoice_item_id\` = i.\`id\`)
            AND NOT EXISTS (SELECT 1 FROM \`product_components\` pc WHERE pc.\`parent_product_id\` = i.\`product_id\`)
           THEN 'manufacturing_fee' ELSE 'manufacturing' END
       WHERE i.\`line_type\` = 'manufacturing' AND i.\`cogs_accrued\` > 0 AND i.\`cogs_source\` IS NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`sales_invoice_items\` DROP COLUMN \`cogs_source\``);
  }
}
