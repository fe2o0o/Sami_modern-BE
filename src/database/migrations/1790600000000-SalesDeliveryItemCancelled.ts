import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A delivery-order line can be CANCELLED (the customer no longer wants the item):
 * its undelivered quantity is credited back through a posted sales return and
 * the line stops appearing as pending. Additive only — two columns with safe
 * defaults; existing rows are untouched (cancelled_quantity = 0).
 */
export class SalesDeliveryItemCancelled1790600000000 implements MigrationInterface {
  name = 'SalesDeliveryItemCancelled1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`sales_delivery_items\` ADD \`cancelled_quantity\` decimal(18,3) NOT NULL DEFAULT '0.000', ADD \`cancel_return_id\` varchar(36) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`sales_delivery_items\` DROP COLUMN \`cancel_return_id\`, DROP COLUMN \`cancelled_quantity\``,
    );
  }
}
