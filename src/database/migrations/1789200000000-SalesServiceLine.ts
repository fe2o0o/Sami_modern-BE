import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sales invoices can carry a SERVICE line (e.g. a cash-withdrawal fee): revenue
 * only, with no stock, reservation, COGS or delivery. Adds 'service' to the
 * line-type enum on invoice and delivery item tables.
 */
export class SalesServiceLine1789200000000 implements MigrationInterface {
  name = 'SalesServiceLine1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`sales_invoice_items\` MODIFY \`line_type\` enum('stock','manufacturing','service') NOT NULL DEFAULT 'stock'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`sales_delivery_items\` MODIFY \`line_type\` enum('stock','manufacturing','service') NOT NULL DEFAULT 'stock'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`sales_delivery_items\` MODIFY \`line_type\` enum('stock','manufacturing') NOT NULL DEFAULT 'stock'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`sales_invoice_items\` MODIFY \`line_type\` enum('stock','manufacturing') NOT NULL DEFAULT 'stock'`,
    );
  }
}
