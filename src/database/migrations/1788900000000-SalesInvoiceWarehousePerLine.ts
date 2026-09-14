import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Warehouse moves from the sales-invoice HEADER to each LINE.
 *
 * - `sales_invoice_items.warehouse_id` becomes NULLABLE: a MANUFACTURING
 *   (made-to-order) line is not sold from any warehouse.
 * - `sales_invoices.warehouse_id` becomes NULLABLE: an all-manufacturing
 *   invoice has no representative warehouse. For mixed invoices it holds the
 *   first stock line's warehouse (a display convenience only).
 *
 * No data backfill is needed — existing rows already carry their warehouse,
 * which now simply lives per line and drives stock reservation/delivery.
 */
export class SalesInvoiceWarehousePerLine1788900000000
  implements MigrationInterface
{
  name = 'SalesInvoiceWarehousePerLine1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`sales_invoice_items\` MODIFY \`warehouse_id\` varchar(255) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`sales_invoices\` MODIFY \`warehouse_id\` varchar(255) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort revert: back-fill any NULLs before restoring NOT NULL so the
    // ALTER cannot fail. A line with no warehouse borrows its invoice header's.
    await queryRunner.query(
      `UPDATE \`sales_invoice_items\` i
       JOIN \`sales_invoices\` s ON s.\`id\` = i.\`sales_invoice_id\`
       SET i.\`warehouse_id\` = s.\`warehouse_id\`
       WHERE i.\`warehouse_id\` IS NULL AND s.\`warehouse_id\` IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`sales_invoices\` MODIFY \`warehouse_id\` varchar(255) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`sales_invoice_items\` MODIFY \`warehouse_id\` varchar(255) NOT NULL`,
    );
  }
}
