import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 1789200000000-SalesServiceLine widened `line_type` to include 'service' on
 * sales_invoice_items and sales_delivery_items but missed sales_return_items,
 * so returning a service line failed on production with "Data truncated for
 * column 'line_type'". Bring the return items in line with the entity.
 */
export class SalesReturnServiceLineType1790200000000 implements MigrationInterface {
  name = 'SalesReturnServiceLineType1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`sales_return_items\` MODIFY \`line_type\` enum('stock','manufacturing','service') NOT NULL DEFAULT 'stock'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`sales_return_items\` MODIFY \`line_type\` enum('stock','manufacturing') NOT NULL DEFAULT 'stock'`,
    );
  }
}
