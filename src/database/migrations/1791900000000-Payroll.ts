import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE = `\`id\` varchar(36) NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` timestamp(6) NULL, \`version\` int NOT NULL DEFAULT '1'`;

/**
 * Mini HR — phase 6: monthly payroll (مسير الرواتب), one run per branch per month.
 *  - payroll_runs / payroll_lines / payroll_payments;
 *  - employees.payroll_branch_id («فرع صرف الراتب») — back-filled for employees
 *    serving exactly one branch;
 *  - accounting settings: salaries expense, salaries payable, payroll deductions
 *    (taxes / insurance) payable;
 *  - advance repayments may now come from a payroll run (method 'payroll').
 * Additive — no existing data is changed except the payroll-branch back-fill.
 */
export class Payroll1791900000000 implements MigrationInterface {
  name = 'Payroll1791900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE \`payroll_runs\` (${BASE}, \`run_number\` varchar(50) NULL, \`branch_id\` varchar(36) NOT NULL, \`branch_name\` varchar(255) NULL, \`period_month\` date NOT NULL, \`status\` enum ('draft','approved','partially_paid','paid','reversed') NOT NULL DEFAULT 'draft', \`total_earnings\` decimal(18,2) NOT NULL DEFAULT 0, \`total_commissions\` decimal(18,2) NOT NULL DEFAULT 0, \`total_bonuses\` decimal(18,2) NOT NULL DEFAULT 0, \`total_deductions\` decimal(18,2) NOT NULL DEFAULT 0, \`total_advances\` decimal(18,2) NOT NULL DEFAULT 0, \`total_net\` decimal(18,2) NOT NULL DEFAULT 0, \`paid_amount\` decimal(18,2) NOT NULL DEFAULT 0, \`employees_count\` int NOT NULL DEFAULT 0, \`notes\` text NULL, \`journal_entry_id\` varchar(36) NULL, \`reversal_journal_entry_id\` varchar(36) NULL, \`approved_by\` varchar(36) NULL, \`approved_at\` datetime NULL, \`reversal_reason\` text NULL, \`created_by\` varchar(36) NULL, \`updated_by\` varchar(36) NULL, UNIQUE INDEX \`UQ_payroll_runs_number\` (\`run_number\`), INDEX \`IDX_payroll_runs_branch_month\` (\`branch_id\`, \`period_month\`), INDEX \`IDX_payroll_runs_status\` (\`status\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`payroll_lines\` (${BASE}, \`run_id\` varchar(36) NOT NULL, \`employee_id\` varchar(36) NOT NULL, \`employee_code\` varchar(50) NULL, \`employee_name\` varchar(255) NULL, \`job_title\` varchar(150) NULL, \`department_name\` varchar(255) NULL, \`salary_package_id\` varchar(36) NULL, \`basic_salary\` decimal(18,2) NOT NULL DEFAULT 0, \`earnings\` decimal(18,2) NOT NULL DEFAULT 0, \`commissions\` decimal(18,2) NOT NULL DEFAULT 0, \`bonuses\` decimal(18,2) NOT NULL DEFAULT 0, \`deductions\` decimal(18,2) NOT NULL DEFAULT 0, \`advances\` decimal(18,2) NOT NULL DEFAULT 0, \`net_pay\` decimal(18,2) NOT NULL DEFAULT 0, \`paid_amount\` decimal(18,2) NOT NULL DEFAULT 0, \`components\` json NULL, \`adjustments\` json NULL, \`advance_allocation\` json NULL, \`commission_detail\` json NULL, \`bank_name\` varchar(255) NULL, \`bank_account_number\` varchar(100) NULL, \`iban\` varchar(100) NULL, \`notes\` text NULL, INDEX \`IDX_payroll_lines_run\` (\`run_id\`), INDEX \`IDX_payroll_lines_employee\` (\`employee_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(`ALTER TABLE \`payroll_lines\` ADD CONSTRAINT \`FK_payroll_lines_run\` FOREIGN KEY (\`run_id\`) REFERENCES \`payroll_runs\`(\`id\`) ON DELETE CASCADE`);
    await q.query(
      `CREATE TABLE \`payroll_payments\` (${BASE}, \`run_id\` varchar(36) NOT NULL, \`payment_date\` date NOT NULL, \`method\` enum ('treasury','bank') NOT NULL, \`treasury_id\` varchar(36) NULL, \`bank_account_id\` varchar(36) NULL, \`amount\` decimal(18,2) NOT NULL, \`lines\` json NOT NULL, \`status\` enum ('posted','reversed') NOT NULL DEFAULT 'posted', \`journal_entry_id\` varchar(36) NULL, \`reversal_journal_entry_id\` varchar(36) NULL, \`notes\` text NULL, \`created_by\` varchar(36) NULL, INDEX \`IDX_payroll_payments_run\` (\`run_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(`ALTER TABLE \`payroll_payments\` ADD CONSTRAINT \`FK_payroll_payments_run\` FOREIGN KEY (\`run_id\`) REFERENCES \`payroll_runs\`(\`id\`) ON DELETE CASCADE`);

    // «فرع صرف الراتب»: back-fill for employees that serve exactly one branch.
    await q.query(`ALTER TABLE \`employees\` ADD \`payroll_branch_id\` varchar(36) NULL`);
    await q.query(`CREATE INDEX \`IDX_employees_payroll_branch\` ON \`employees\` (\`payroll_branch_id\`)`);
    await q.query(`
      UPDATE \`employees\` e
        JOIN (SELECT \`employee_id\`, MIN(\`branch_id\`) AS b FROM \`employee_branches\` GROUP BY \`employee_id\` HAVING COUNT(*) = 1) one
          ON one.\`employee_id\` = e.\`id\`
         SET e.\`payroll_branch_id\` = one.b
       WHERE e.\`payroll_branch_id\` IS NULL`);

    await q.query(`ALTER TABLE \`accounting_settings\` ADD \`salaries_expense_account_id\` varchar(36) NULL`);
    await q.query(`ALTER TABLE \`accounting_settings\` ADD \`salaries_payable_account_id\` varchar(36) NULL`);
    await q.query(`ALTER TABLE \`accounting_settings\` ADD \`payroll_deductions_account_id\` varchar(36) NULL`);

    await q.query(`ALTER TABLE \`employee_advance_repayments\` MODIFY \`method\` enum ('treasury','bank','payroll') NOT NULL`);
    await q.query(`ALTER TABLE \`employee_advance_repayments\` ADD \`payroll_run_id\` varchar(36) NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`employee_advance_repayments\` DROP COLUMN \`payroll_run_id\``);
    await q.query(`DELETE FROM \`employee_advance_repayments\` WHERE \`method\` = 'payroll'`);
    await q.query(`ALTER TABLE \`employee_advance_repayments\` MODIFY \`method\` enum ('treasury','bank') NOT NULL`);
    await q.query(`ALTER TABLE \`accounting_settings\` DROP COLUMN \`payroll_deductions_account_id\``);
    await q.query(`ALTER TABLE \`accounting_settings\` DROP COLUMN \`salaries_payable_account_id\``);
    await q.query(`ALTER TABLE \`accounting_settings\` DROP COLUMN \`salaries_expense_account_id\``);
    await q.query(`DROP INDEX \`IDX_employees_payroll_branch\` ON \`employees\``);
    await q.query(`ALTER TABLE \`employees\` DROP COLUMN \`payroll_branch_id\``);
    await q.query(`DROP TABLE \`payroll_payments\``);
    await q.query(`DROP TABLE \`payroll_lines\``);
    await q.query(`DROP TABLE \`payroll_runs\``);
  }
}
