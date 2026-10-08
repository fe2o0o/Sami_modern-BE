import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cost of sales recognised WITH the sales invoice (matching principle):
 *  - accounting_settings.goods_sold_not_delivered_account_id — the clearing
 *    account «بضاعة مباعة لم تُسلَّم». While it is empty the old behaviour
 *    (COGS at delivery) stays in force, so existing data/flows are unaffected.
 *  - sales_invoice_items: the cost accrued at posting and how much of it was
 *    settled by deliveries / released by returns.
 *  - sales_delivery_items / sales_return_items: the accrual each line settled/released.
 * Additive only — all columns nullable or defaulted to 0; no existing row changes.
 */
export class CogsAtInvoice1790700000000 implements MigrationInterface {
  name = 'CogsAtInvoice1790700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`accounting_settings\` ADD \`goods_sold_not_delivered_account_id\` varchar(36) NULL`);
    await q.query(
      `ALTER TABLE \`sales_invoice_items\` ADD \`cogs_accrued\` decimal(18,2) NOT NULL DEFAULT '0.00', ADD \`cogs_accrued_settled\` decimal(18,2) NOT NULL DEFAULT '0.00', ADD \`cogs_released_qty\` decimal(18,3) NOT NULL DEFAULT '0.000'`,
    );
    await q.query(`ALTER TABLE \`sales_delivery_items\` ADD \`cogs_accrual_settled\` decimal(18,2) NOT NULL DEFAULT '0.00'`);
    await q.query(
      `ALTER TABLE \`sales_return_items\` ADD \`cogs_accrual_released\` decimal(18,2) NOT NULL DEFAULT '0.00', ADD \`cogs_accrual_released_qty\` decimal(18,3) NOT NULL DEFAULT '0.000'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`sales_return_items\` DROP COLUMN \`cogs_accrual_released_qty\`, DROP COLUMN \`cogs_accrual_released\``);
    await q.query(`ALTER TABLE \`sales_delivery_items\` DROP COLUMN \`cogs_accrual_settled\``);
    await q.query(`ALTER TABLE \`sales_invoice_items\` DROP COLUMN \`cogs_released_qty\`, DROP COLUMN \`cogs_accrued_settled\`, DROP COLUMN \`cogs_accrued\``);
    await q.query(`ALTER TABLE \`accounting_settings\` DROP COLUMN \`goods_sold_not_delivered_account_id\``);
  }
}
