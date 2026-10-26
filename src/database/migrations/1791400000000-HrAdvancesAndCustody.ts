import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE = `\`id\` varchar(36) NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` timestamp(6) NULL, \`version\` int NOT NULL DEFAULT '1'`;
const CASH = `enum ('treasury','bank')`;
const MOVE = `enum ('posted','reversed') NOT NULL DEFAULT 'posted'`;

/**
 * Mini HR — phase 3: employee advances (+ installments, repayments), employee
 * custody (+ settlements) and the two employee accounts in accounting settings
 * (+ optional max-advance multiple). Additive only; the accounts are chosen by
 * the user in the accounting settings (not guessed here).
 */
export class HrAdvancesAndCustody1791400000000 implements MigrationInterface {
  name = 'HrAdvancesAndCustody1791400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`accounting_settings\`
      ADD \`employee_advances_account_id\` varchar(36) NULL,
      ADD \`employee_custody_account_id\` varchar(36) NULL,
      ADD \`max_advance_salary_multiple\` decimal(6,2) NULL`);

    await q.query(
      `CREATE TABLE \`employee_advances\` (${BASE}, \`advance_number\` varchar(50) NULL, \`employee_id\` varchar(36) NOT NULL, \`employee_name\` varchar(255) NULL, \`branch_id\` varchar(36) NULL, \`request_date\` date NOT NULL, \`amount\` decimal(18,2) NOT NULL, \`installments_count\` int NOT NULL DEFAULT 1, \`first_deduction_month\` date NOT NULL, \`reason\` text NULL, \`status\` enum ('draft','approved','paid','settled','cancelled','reversed') NOT NULL DEFAULT 'draft', \`repaid_amount\` decimal(18,2) NOT NULL DEFAULT 0, \`approved_by\` varchar(36) NULL, \`approved_at\` datetime NULL, \`paid_date\` date NULL, \`payment_method\` ${CASH} NULL, \`treasury_id\` varchar(36) NULL, \`bank_account_id\` varchar(36) NULL, \`journal_entry_id\` varchar(36) NULL, \`reversal_journal_entry_id\` varchar(36) NULL, \`cancel_reason\` text NULL, \`created_by\` varchar(36) NULL, \`updated_by\` varchar(36) NULL, UNIQUE INDEX \`UQ_employee_advances_number\` (\`advance_number\`), INDEX \`IDX_employee_advances_employee\` (\`employee_id\`), INDEX \`IDX_employee_advances_branch\` (\`branch_id\`), INDEX \`IDX_employee_advances_status\` (\`status\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(`ALTER TABLE \`employee_advances\` ADD CONSTRAINT \`FK_employee_advances_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`employees\`(\`id\`) ON DELETE RESTRICT`);
    await q.query(
      `CREATE TABLE \`employee_advance_installments\` (${BASE}, \`advance_id\` varchar(36) NOT NULL, \`sequence\` int NOT NULL, \`due_month\` date NOT NULL, \`amount\` decimal(18,2) NOT NULL, \`paid_amount\` decimal(18,2) NOT NULL DEFAULT 0, \`status\` enum ('pending','partial','paid') NOT NULL DEFAULT 'pending', INDEX \`IDX_employee_advance_installments_advance\` (\`advance_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(`ALTER TABLE \`employee_advance_installments\` ADD CONSTRAINT \`FK_employee_advance_installments_advance\` FOREIGN KEY (\`advance_id\`) REFERENCES \`employee_advances\`(\`id\`) ON DELETE CASCADE`);
    await q.query(
      `CREATE TABLE \`employee_advance_repayments\` (${BASE}, \`advance_id\` varchar(36) NOT NULL, \`repayment_date\` date NOT NULL, \`amount\` decimal(18,2) NOT NULL, \`method\` ${CASH} NOT NULL, \`treasury_id\` varchar(36) NULL, \`bank_account_id\` varchar(36) NULL, \`status\` ${MOVE}, \`journal_entry_id\` varchar(36) NULL, \`reversal_journal_entry_id\` varchar(36) NULL, \`notes\` text NULL, \`allocation\` json NULL, \`created_by\` varchar(36) NULL, INDEX \`IDX_employee_advance_repayments_advance\` (\`advance_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(`ALTER TABLE \`employee_advance_repayments\` ADD CONSTRAINT \`FK_employee_advance_repayments_advance\` FOREIGN KEY (\`advance_id\`) REFERENCES \`employee_advances\`(\`id\`) ON DELETE CASCADE`);

    await q.query(
      `CREATE TABLE \`employee_custodies\` (${BASE}, \`custody_number\` varchar(50) NULL, \`employee_id\` varchar(36) NOT NULL, \`employee_name\` varchar(255) NULL, \`branch_id\` varchar(36) NULL, \`custody_date\` date NOT NULL, \`amount\` decimal(18,2) NOT NULL, \`purpose\` text NULL, \`status\` enum ('draft','open','partial','settled','reversed') NOT NULL DEFAULT 'draft', \`settled_amount\` decimal(18,2) NOT NULL DEFAULT 0, \`payment_method\` ${CASH} NOT NULL, \`treasury_id\` varchar(36) NULL, \`bank_account_id\` varchar(36) NULL, \`journal_entry_id\` varchar(36) NULL, \`reversal_journal_entry_id\` varchar(36) NULL, \`created_by\` varchar(36) NULL, \`updated_by\` varchar(36) NULL, UNIQUE INDEX \`UQ_employee_custodies_number\` (\`custody_number\`), INDEX \`IDX_employee_custodies_employee\` (\`employee_id\`), INDEX \`IDX_employee_custodies_branch\` (\`branch_id\`), INDEX \`IDX_employee_custodies_status\` (\`status\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(`ALTER TABLE \`employee_custodies\` ADD CONSTRAINT \`FK_employee_custodies_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`employees\`(\`id\`) ON DELETE RESTRICT`);
    await q.query(
      `CREATE TABLE \`employee_custody_settlements\` (${BASE}, \`custody_id\` varchar(36) NOT NULL, \`settlement_date\` date NOT NULL, \`settlement_type\` enum ('cash_return','expenses') NOT NULL, \`amount\` decimal(18,2) NOT NULL, \`method\` ${CASH} NULL, \`treasury_id\` varchar(36) NULL, \`bank_account_id\` varchar(36) NULL, \`expense_lines\` json NULL, \`status\` ${MOVE}, \`journal_entry_id\` varchar(36) NULL, \`reversal_journal_entry_id\` varchar(36) NULL, \`notes\` text NULL, \`created_by\` varchar(36) NULL, INDEX \`IDX_employee_custody_settlements_custody\` (\`custody_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(`ALTER TABLE \`employee_custody_settlements\` ADD CONSTRAINT \`FK_employee_custody_settlements_custody\` FOREIGN KEY (\`custody_id\`) REFERENCES \`employee_custodies\`(\`id\`) ON DELETE CASCADE`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE \`employee_custody_settlements\``);
    await q.query(`DROP TABLE \`employee_custodies\``);
    await q.query(`DROP TABLE \`employee_advance_repayments\``);
    await q.query(`DROP TABLE \`employee_advance_installments\``);
    await q.query(`DROP TABLE \`employee_advances\``);
    await q.query(`ALTER TABLE \`accounting_settings\` DROP COLUMN \`employee_advances_account_id\`, DROP COLUMN \`employee_custody_account_id\`, DROP COLUMN \`max_advance_salary_multiple\``);
  }
}
