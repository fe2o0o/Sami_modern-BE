import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A manufacturing sales-invoice line's per-order BOM component can specify which
 * warehouse it is drawn from (a warehouse of the invoice's branch). This flows
 * into the spawned manufacturing order's component warehouse.
 */
export class SalesInvoiceComponentWarehouse1789700000000 implements MigrationInterface {
  name = 'SalesInvoiceComponentWarehouse1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`sales_invoice_item_components\` ADD \`warehouse_id\` varchar(36) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`sales_invoice_item_components\` DROP COLUMN \`warehouse_id\``,
    );
  }
}
