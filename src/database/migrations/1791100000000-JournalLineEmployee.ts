import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Employee as a journal-line party (custody / advances — «العهد والسلف»).
 *  - chart_of_accounts.requires_employee: a posting account flagged this way
 *    asks for an employee on every manual journal line (like the customer /
 *    supplier control accounts ask for their party);
 *  - journal_entry_lines.employee_id: the employee the line belongs to.
 * Existing posting accounts whose name mentions «عهد» or «سلف» are flagged.
 * Additive: posted entries are untouched.
 */
export class JournalLineEmployee1791100000000 implements MigrationInterface {
  name = 'JournalLineEmployee1791100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`chart_of_accounts\` ADD \`requires_employee\` tinyint NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE \`journal_entry_lines\` ADD \`employee_id\` varchar(36) NULL`);
    await q.query(`CREATE INDEX \`IDX_journal_entry_lines_employee\` ON \`journal_entry_lines\` (\`employee_id\`)`);
    await q.query(
      `ALTER TABLE \`journal_entry_lines\` ADD CONSTRAINT \`FK_journal_entry_lines_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`employees\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await q.query(
      `UPDATE \`chart_of_accounts\` SET \`requires_employee\` = 1
        WHERE \`deleted_at\` IS NULL AND \`allow_posting\` = 1 AND \`is_header\` = 0
          AND (\`account_name_ar\` LIKE '%عهد%' OR \`account_name_ar\` LIKE '%سلف%')`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`journal_entry_lines\` DROP FOREIGN KEY \`FK_journal_entry_lines_employee\``);
    await q.query(`DROP INDEX \`IDX_journal_entry_lines_employee\` ON \`journal_entry_lines\``);
    await q.query(`ALTER TABLE \`journal_entry_lines\` DROP COLUMN \`employee_id\``);
    await q.query(`ALTER TABLE \`chart_of_accounts\` DROP COLUMN \`requires_employee\``);
  }
}
