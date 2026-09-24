import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Each manufacturing-order component can be consumed from its own warehouse
 * (falls back to the order's output warehouse at production when null).
 */
export class ManufacturingComponentWarehouse1789600000000 implements MigrationInterface {
  name = 'ManufacturingComponentWarehouse1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`manufacturing_order_components\` ADD \`warehouse_id\` varchar(36) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`manufacturing_order_components\` DROP COLUMN \`warehouse_id\``,
    );
  }
}
