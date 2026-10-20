import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quantity of a sales-return line that went back INTO stock. For manufacturing
 * lines only the delivered part is restocked (the undelivered part releases the
 * invoice's cost accrual instead); reversing the return re-issues exactly this.
 * Additive, defaults to 0 for existing rows.
 */
export class SalesReturnItemRestocked1790900000000 implements MigrationInterface {
  name = 'SalesReturnItemRestocked1790900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`sales_return_items\` ADD \`restocked_quantity\` decimal(18,3) NOT NULL DEFAULT 0`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`sales_return_items\` DROP COLUMN \`restocked_quantity\``);
  }
}
