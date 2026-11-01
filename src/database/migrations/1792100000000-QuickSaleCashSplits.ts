import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quick sale split collection: part cash / part bank (any number of treasuries and
 * bank accounts). Stored on the invoice as JSON [{ cashAccountId, amount, accountName }];
 * null keeps the single `cash_account_id` behaviour. Additive.
 */
export class QuickSaleCashSplits1792100000000 implements MigrationInterface {
  name = 'QuickSaleCashSplits1792100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`sales_invoices\` ADD \`cash_splits\` json NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`sales_invoices\` DROP COLUMN \`cash_splits\``);
  }
}
