import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Manufacturing fee is now booked to the factory (supplier) when execution
 * starts. Track that posting on the order.
 */
export class ManufacturingFeeBooking1790000000000 implements MigrationInterface {
  name = 'ManufacturingFeeBooking1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`manufacturing_orders\` ADD \`fee_journal_entry_id\` varchar(36) NULL, ADD \`fee_booked_at\` datetime NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`manufacturing_orders\` DROP COLUMN \`fee_booked_at\`, DROP COLUMN \`fee_journal_entry_id\``,
    );
  }
}
