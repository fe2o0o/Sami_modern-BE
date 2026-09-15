import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vouchers can move cash against a GL account directly (e.g. paying an expense
 * like electricity/commissions, or receiving other income), not only a
 * customer/supplier.
 *
 * - Adds `party_type` (customer | supplier | account) — back-filled from the
 *   voucher type for existing rows (receipt→customer, payment→supplier).
 * - Adds nullable `account_id` (the GL account for the ACCOUNT type).
 * - Makes `party_id` NULLABLE (an ACCOUNT voucher has no party subledger).
 */
export class VoucherAccountParty1789000000000 implements MigrationInterface {
  name = 'VoucherAccountParty1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`vouchers\` ADD \`party_type\` enum('customer','supplier','account') NOT NULL DEFAULT 'supplier'`,
    );
    await queryRunner.query(`ALTER TABLE \`vouchers\` ADD \`account_id\` varchar(255) NULL`);
    await queryRunner.query(
      `UPDATE \`vouchers\` SET \`party_type\` = CASE WHEN \`type\` = 'receipt' THEN 'customer' ELSE 'supplier' END`,
    );
    await queryRunner.query(`ALTER TABLE \`vouchers\` MODIFY \`party_id\` varchar(255) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Account-type vouchers have a NULL party_id, so leave party_id nullable on
    // the way down rather than fail restoring NOT NULL.
    await queryRunner.query(`ALTER TABLE \`vouchers\` DROP COLUMN \`account_id\``);
    await queryRunner.query(`ALTER TABLE \`vouchers\` DROP COLUMN \`party_type\``);
  }
}
