import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Accounting accounts move up from the product to its CATEGORY: inventory,
 * COGS and revenue are set once per category (inherited by sub-categories)
 * instead of on every product. Product-level columns stay as a legacy
 * fallback; resolution is category → product → accounting-settings default.
 * Additive only: three nullable columns, no data is touched.
 */
export class ProductCategoryAccounts1790300000000 implements MigrationInterface {
  name = 'ProductCategoryAccounts1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`product_categories\` ADD \`inventory_account_id\` varchar(36) NULL, ADD \`cogs_account_id\` varchar(36) NULL, ADD \`sales_account_id\` varchar(36) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`product_categories\` DROP COLUMN \`sales_account_id\`, DROP COLUMN \`cogs_account_id\`, DROP COLUMN \`inventory_account_id\``,
    );
  }
}
