import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «سلفة من رصيد قائم»: an advance document registered for money that already
 * reached the employee-advances account (e.g. a manual journal entry), so it gets
 * an installment schedule that payroll deducts — without posting a new entry.
 * Additive.
 */
export class AdvanceFromExistingBalance1792600000000 implements MigrationInterface {
  name = 'AdvanceFromExistingBalance1792600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`employee_advances\` ADD \`from_existing_balance\` tinyint(1) NOT NULL DEFAULT 0`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`employee_advances\` DROP COLUMN \`from_existing_balance\``);
  }
}
