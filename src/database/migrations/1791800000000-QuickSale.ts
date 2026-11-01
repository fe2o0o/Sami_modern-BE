import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quick sale (بيع سريع): a cash invoice for a walk-in customer, sold straight from
 * stock — goods are issued and cost is booked when it posts (no reservation, no
 * delivery order, no manufacturing). It is recorded against one system customer
 * («عميل بيع سريع»); the walk-in's name / mobile live on the invoice only. Additive.
 */
export class QuickSale1791800000000 implements MigrationInterface {
  name = 'QuickSale1791800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`sales_invoices\` ADD \`is_quick_sale\` tinyint NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE \`sales_invoices\` ADD \`walk_in_customer_name\` varchar(255) NULL`);
    await q.query(`ALTER TABLE \`sales_invoices\` ADD \`walk_in_customer_mobile\` varchar(30) NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`sales_invoices\` DROP COLUMN \`walk_in_customer_mobile\``);
    await q.query(`ALTER TABLE \`sales_invoices\` DROP COLUMN \`walk_in_customer_name\``);
    await q.query(`ALTER TABLE \`sales_invoices\` DROP COLUMN \`is_quick_sale\``);
  }
}
