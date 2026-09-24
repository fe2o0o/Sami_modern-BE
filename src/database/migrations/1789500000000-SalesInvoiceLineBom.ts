import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-order BOM on a MANUFACTURING sales-invoice line: a product can be produced
 * with a custom recipe for a single invoice without changing the product's own
 * default BOM. Copied (× line quantity) into the spawned manufacturing order on
 * posting.
 */
export class SalesInvoiceLineBom1789500000000 implements MigrationInterface {
  name = 'SalesInvoiceLineBom1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`sales_invoice_item_components\` (
        \`id\` varchar(36) NOT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` timestamp(6) NULL,
        \`version\` int NOT NULL DEFAULT '1',
        \`sales_invoice_item_id\` varchar(36) NOT NULL,
        \`line_number\` int NOT NULL DEFAULT '1',
        \`component_product_id\` varchar(36) NOT NULL,
        \`component_product_name\` varchar(255) NULL,
        \`unit_name\` varchar(100) NULL,
        \`quantity\` decimal(18,3) NOT NULL DEFAULT '0.000',
        INDEX \`IDX_sii_components_item\` (\`sales_invoice_item_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`sales_invoice_item_components\``);
  }
}
