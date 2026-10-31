import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A sales return of manufacturing quantity that was never delivered now closes
 * that quantity on the delivery order (it must not ship after being credited).
 * `closed_quantity` records exactly how much each return line closed, so that
 * reversing the return re-opens the same amount. Existing rows stay 0. Additive.
 */
export class SalesReturnClosedQuantity1791500000000 implements MigrationInterface {
  name = 'SalesReturnClosedQuantity1791500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`sales_return_items\` ADD \`closed_quantity\` decimal(18,3) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE \`sales_return_items\` ADD \`manufacturing_action\` varchar(20) NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`sales_return_items\` DROP COLUMN \`manufacturing_action\``);
    await q.query(`ALTER TABLE \`sales_return_items\` DROP COLUMN \`closed_quantity\``);
  }
}
