import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A manufacturing invoice line can name its factory (external supplier) and
 * the manufacturing fee up front, so the manufacturing order created at
 * posting already carries them. Nothing is posted to the supplier until the
 * order is started. Additive only (two nullable/defaulted columns).
 */
export class SalesInvoiceItemFactory1790400000000 implements MigrationInterface {
  name = 'SalesInvoiceItemFactory1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`sales_invoice_items\` ADD \`factory_supplier_id\` varchar(36) NULL, ADD \`manufacturing_fee\` decimal(15,2) NOT NULL DEFAULT '0.00'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`sales_invoice_items\` DROP COLUMN \`manufacturing_fee\`, DROP COLUMN \`factory_supplier_id\``,
    );
  }
}
