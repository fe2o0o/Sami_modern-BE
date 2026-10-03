import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A manual journal line on a cash/bank GL account can name the exact treasury
 * or bank account it belongs to (several may share one GL account), instead of
 * always landing on the first one found. Additive only: two nullable columns.
 */
export class JournalLineCashParty1790500000000 implements MigrationInterface {
  name = 'JournalLineCashParty1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`journal_entry_lines\` ADD \`treasury_id\` varchar(36) NULL, ADD \`bank_account_id\` varchar(36) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`journal_entry_lines\` DROP COLUMN \`bank_account_id\`, DROP COLUMN \`treasury_id\``,
    );
  }
}
