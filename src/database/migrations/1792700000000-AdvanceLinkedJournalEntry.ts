import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The journal entry an «سلفة من رصيد قائم» stands on (one advance per entry).
 * Only added when missing: some databases already got the column while the
 * feature was being built.
 */
export class AdvanceLinkedJournalEntry1792700000000 implements MigrationInterface {
  name = 'AdvanceLinkedJournalEntry1792700000000';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await q.hasColumn('employee_advances', 'linked_journal_entry_id'))) {
      await q.query(`ALTER TABLE \`employee_advances\` ADD \`linked_journal_entry_id\` varchar(36) NULL`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasColumn('employee_advances', 'linked_journal_entry_id')) {
      await q.query(`ALTER TABLE \`employee_advances\` DROP COLUMN \`linked_journal_entry_id\``);
    }
  }
}
