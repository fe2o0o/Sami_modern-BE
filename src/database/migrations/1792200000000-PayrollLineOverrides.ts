import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payroll line manual amounts: the month's commission and the advance installment
 * to recover can be set by hand on a draft run (null = calculated). `advance_due`
 * keeps the open installments due up to the month, shown next to the override.
 * Additive.
 */
export class PayrollLineOverrides1792200000000 implements MigrationInterface {
  name = 'PayrollLineOverrides1792200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE \`payroll_lines\` ADD \`commission_override\` decimal(18,2) NULL, ADD \`advance_override\` decimal(18,2) NULL, ADD \`advance_due\` decimal(18,2) NOT NULL DEFAULT 0`,
    );
    // existing lines: at least what is already planned for recovery («تحديث» recalculates it)
    await q.query(`UPDATE \`payroll_lines\` SET \`advance_due\` = \`advances\``);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`payroll_lines\` DROP COLUMN \`advance_due\`, DROP COLUMN \`advance_override\`, DROP COLUMN \`commission_override\``);
  }
}
