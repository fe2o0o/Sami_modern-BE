import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';

const BASE = `\`id\` varchar(36) NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` timestamp(6) NULL, \`version\` int NOT NULL DEFAULT '1'`;

/**
 * Mini HR — phase 5 + «بوابة الموظف»:
 *  - leave_types (seeded: annual 21, casual 6, sick 15, unpaid without balance),
 *    employee_leave_balances (HR's own entitlement per year), leave_requests;
 *  - hr_requests (employee → HR tickets);
 *  - employees.app_permissions (sections of the employee app; NULL = defaults).
 * Additive only — no existing data is changed.
 */
export class LeaveAndEmployeePortal1793000000000 implements MigrationInterface {
  name = 'LeaveAndEmployeePortal1793000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE \`leave_types\` (${BASE}, \`name\` varchar(150) NOT NULL, \`name_en\` varchar(150) NULL, \`default_days_per_year\` decimal(6,1) NOT NULL DEFAULT 0, \`has_balance\` tinyint NOT NULL DEFAULT 1, \`is_paid\` tinyint NOT NULL DEFAULT 1, \`is_active\` tinyint NOT NULL DEFAULT 1, \`sort_order\` int NOT NULL DEFAULT 0, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`employee_leave_balances\` (${BASE}, \`employee_id\` varchar(36) NOT NULL, \`leave_type_id\` varchar(36) NOT NULL, \`year\` int NOT NULL, \`entitled_days\` decimal(6,1) NOT NULL DEFAULT 0, \`notes\` text NULL, UNIQUE INDEX \`UQ_employee_leave_balances\` (\`employee_id\`, \`leave_type_id\`, \`year\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`leave_requests\` (${BASE}, \`employee_id\` varchar(36) NOT NULL, \`leave_type_id\` varchar(36) NOT NULL, \`leave_type_name\` varchar(150) NOT NULL, \`from_date\` date NOT NULL, \`to_date\` date NOT NULL, \`days\` decimal(6,1) NOT NULL DEFAULT 0, \`reason\` text NULL, \`status\` enum ('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending', \`source\` enum ('app','erp') NOT NULL DEFAULT 'app', \`created_by_user_id\` varchar(36) NULL, \`decided_by_user_id\` varchar(36) NULL, \`decided_at\` datetime NULL, \`decision_note\` text NULL, INDEX \`IDX_leave_requests_employee_dates\` (\`employee_id\`, \`from_date\`, \`to_date\`), INDEX \`IDX_leave_requests_status\` (\`status\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(
      `ALTER TABLE \`leave_requests\` ADD CONSTRAINT \`FK_leave_requests_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`employees\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `CREATE TABLE \`hr_requests\` (${BASE}, \`employee_id\` varchar(36) NOT NULL, \`request_type\` enum ('advance','salary_certificate','work_certificate','punch_correction','complaint','suggestion','other') NOT NULL, \`subject\` varchar(200) NOT NULL, \`details\` text NULL, \`amount\` decimal(18,2) NULL, \`status\` enum ('new','in_progress','done','rejected','cancelled') NOT NULL DEFAULT 'new', \`reply\` text NULL, \`handled_by_user_id\` varchar(36) NULL, \`handled_at\` datetime NULL, INDEX \`IDX_hr_requests_employee\` (\`employee_id\`), INDEX \`IDX_hr_requests_status\` (\`status\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(
      `ALTER TABLE \`hr_requests\` ADD CONSTRAINT \`FK_hr_requests_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`employees\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    if (!(await q.hasColumn('employees', 'app_permissions'))) {
      await q.query(`ALTER TABLE \`employees\` ADD \`app_permissions\` text NULL`);
    }

    const seed: [string, string, number, number, number, number][] = [
      ['سنوية', 'Annual', 21, 1, 1, 1],
      ['عارضة', 'Casual', 6, 1, 1, 2],
      ['مرضية', 'Sick', 15, 1, 1, 3],
      ['بدون أجر', 'Unpaid', 0, 0, 0, 4],
    ];
    for (const [name, nameEn, days, hasBalance, isPaid, order] of seed) {
      await q.query(
        'INSERT INTO `leave_types` (`id`, `name`, `name_en`, `default_days_per_year`, `has_balance`, `is_paid`, `is_active`, `sort_order`) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
        [randomUUID(), name, nameEn, days, hasBalance, isPaid, order],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await q.hasColumn('employees', 'app_permissions')) await q.query('ALTER TABLE `employees` DROP COLUMN `app_permissions`');
    await q.query('DROP TABLE IF EXISTS `hr_requests`');
    await q.query('DROP TABLE IF EXISTS `leave_requests`');
    await q.query('DROP TABLE IF EXISTS `employee_leave_balances`');
    await q.query('DROP TABLE IF EXISTS `leave_types`');
  }
}
