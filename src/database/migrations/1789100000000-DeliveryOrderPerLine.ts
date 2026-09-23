import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Delivery notes become living "delivery orders" (one per invoice) that are
 * fulfilled line-by-line:
 * - `sales_deliveries` gains `expected_delivery_date` (user-entered plan) and
 *   `delivery_progress` (pending | partial | delivered).
 * - `sales_delivery_items` gains `ordered_quantity`, `delivered_quantity`,
 *   `actual_delivery_date`, and `line_type` (stock | manufacturing).
 *
 * Existing rows are back-filled so history reads correctly: an already-posted
 * delivery counts as fully delivered.
 */
export class DeliveryOrderPerLine1789100000000 implements MigrationInterface {
  name = 'DeliveryOrderPerLine1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`sales_deliveries\` ADD \`expected_delivery_date\` date NULL`);
    await queryRunner.query(
      `ALTER TABLE \`sales_deliveries\` ADD \`delivery_progress\` enum('pending','partial','delivered') NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`sales_delivery_items\` ADD \`ordered_quantity\` decimal(18,3) NOT NULL DEFAULT '0.000'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`sales_delivery_items\` ADD \`delivered_quantity\` decimal(18,3) NOT NULL DEFAULT '0.000'`,
    );
    await queryRunner.query(`ALTER TABLE \`sales_delivery_items\` ADD \`actual_delivery_date\` date NULL`);
    await queryRunner.query(
      `ALTER TABLE \`sales_delivery_items\` ADD \`line_type\` enum('stock','manufacturing') NOT NULL DEFAULT 'stock'`,
    );

    // Back-fill existing rows: treat each existing line's quantity as both ordered
    // and (for posted notes) delivered; set progress from the note's status.
    await queryRunner.query(
      `UPDATE \`sales_delivery_items\` SET \`ordered_quantity\` = \`quantity\``,
    );
    await queryRunner.query(`
      UPDATE \`sales_delivery_items\` i
      JOIN \`sales_deliveries\` d ON d.\`id\` = i.\`sales_delivery_id\`
      SET i.\`delivered_quantity\` = i.\`quantity\`, i.\`actual_delivery_date\` = d.\`delivery_date\`
      WHERE d.\`status\` = 'posted'
    `);
    await queryRunner.query(
      `UPDATE \`sales_deliveries\` SET \`delivery_progress\` = CASE WHEN \`status\` = 'posted' THEN 'delivered' ELSE 'pending' END`,
    );
    await queryRunner.query(
      `UPDATE \`sales_deliveries\` SET \`expected_delivery_date\` = \`delivery_date\` WHERE \`expected_delivery_date\` IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`sales_delivery_items\` DROP COLUMN \`line_type\``);
    await queryRunner.query(`ALTER TABLE \`sales_delivery_items\` DROP COLUMN \`actual_delivery_date\``);
    await queryRunner.query(`ALTER TABLE \`sales_delivery_items\` DROP COLUMN \`delivered_quantity\``);
    await queryRunner.query(`ALTER TABLE \`sales_delivery_items\` DROP COLUMN \`ordered_quantity\``);
    await queryRunner.query(`ALTER TABLE \`sales_deliveries\` DROP COLUMN \`delivery_progress\``);
    await queryRunner.query(`ALTER TABLE \`sales_deliveries\` DROP COLUMN \`expected_delivery_date\``);
  }
}
