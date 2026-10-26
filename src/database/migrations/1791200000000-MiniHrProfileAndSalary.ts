import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE = `\`id\` varchar(36) NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` timestamp(6) NULL, \`version\` int NOT NULL DEFAULT '1'`;

/**
 * Mini HR — phase 1 (employee profile) + phase 2 (salary structure).
 * Additive only:
 *  - departments, job_grades, employee_status_changes, employee_documents;
 *  - employees: department / grade / manager / contract / personal / bank /
 *    emergency / status / user link / photo columns (all nullable);
 *  - pay_components (+ BASIC and three common components), salary_packages,
 *    salary_package_lines;
 *  - data: every employee with a net salary gets a package «أساسي = net salary»
 *    effective from the hire date (or today); inactive employees start as
 *    «terminated» so they keep disappearing from pickers.
 */
export class MiniHrProfileAndSalary1791200000000 implements MigrationInterface {
  name = 'MiniHrProfileAndSalary1791200000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── lookups ──
    await q.query(
      `CREATE TABLE \`departments\` (${BASE}, \`code\` varchar(50) NOT NULL, \`name\` varchar(255) NOT NULL, \`name_en\` varchar(255) NULL, \`manager_employee_id\` varchar(36) NULL, \`notes\` text NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, UNIQUE INDEX \`UQ_departments_code\` (\`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`job_grades\` (${BASE}, \`code\` varchar(50) NOT NULL, \`name\` varchar(255) NOT NULL, \`name_en\` varchar(255) NULL, \`level\` int NOT NULL DEFAULT 1, \`notes\` text NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, UNIQUE INDEX \`UQ_job_grades_code\` (\`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );

    // ── employee profile columns ──
    await q.query(`ALTER TABLE \`employees\`
      ADD \`department_id\` varchar(36) NULL,
      ADD \`job_grade_id\` varchar(36) NULL,
      ADD \`direct_manager_id\` varchar(36) NULL,
      ADD \`contract_type\` enum ('permanent','temporary','piecework','trainee') NULL,
      ADD \`contract_start\` date NULL,
      ADD \`contract_end\` date NULL,
      ADD \`birth_date\` date NULL,
      ADD \`gender\` enum ('male','female') NULL,
      ADD \`marital_status\` enum ('single','married','divorced','widowed') NULL,
      ADD \`address\` text NULL,
      ADD \`qualification\` varchar(255) NULL,
      ADD \`social_insurance_number\` varchar(50) NULL,
      ADD \`bank_name\` varchar(150) NULL,
      ADD \`bank_account_number\` varchar(50) NULL,
      ADD \`iban\` varchar(50) NULL,
      ADD \`emergency_contact_name\` varchar(255) NULL,
      ADD \`emergency_contact_relation\` varchar(100) NULL,
      ADD \`emergency_contact_mobile\` varchar(30) NULL,
      ADD \`employment_status\` enum ('active','on_leave','resigned','terminated') NOT NULL DEFAULT 'active',
      ADD \`exit_date\` date NULL,
      ADD \`exit_reason\` text NULL,
      ADD \`user_id\` varchar(36) NULL,
      ADD \`photo_name\` varchar(255) NULL`);
    await q.query(`CREATE UNIQUE INDEX \`UQ_employees_user\` ON \`employees\` (\`user_id\`)`);
    await q.query(`ALTER TABLE \`employees\` ADD CONSTRAINT \`FK_employees_department\` FOREIGN KEY (\`department_id\`) REFERENCES \`departments\`(\`id\`) ON DELETE SET NULL`);
    await q.query(`ALTER TABLE \`employees\` ADD CONSTRAINT \`FK_employees_job_grade\` FOREIGN KEY (\`job_grade_id\`) REFERENCES \`job_grades\`(\`id\`) ON DELETE SET NULL`);
    await q.query(`ALTER TABLE \`employees\` ADD CONSTRAINT \`FK_employees_direct_manager\` FOREIGN KEY (\`direct_manager_id\`) REFERENCES \`employees\`(\`id\`) ON DELETE SET NULL`);
    await q.query(`ALTER TABLE \`employees\` ADD CONSTRAINT \`FK_employees_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL`);
    await q.query(`ALTER TABLE \`departments\` ADD CONSTRAINT \`FK_departments_manager\` FOREIGN KEY (\`manager_employee_id\`) REFERENCES \`employees\`(\`id\`) ON DELETE SET NULL`);
    await q.query(
      `UPDATE \`employees\` SET \`employment_status\` = 'terminated', \`exit_reason\` = 'غير نشط قبل تفعيل الموارد البشرية' WHERE \`is_active\` = 0`,
    );

    // ── status history + documents ──
    await q.query(
      `CREATE TABLE \`employee_status_changes\` (${BASE}, \`employee_id\` varchar(36) NOT NULL, \`from_status\` enum ('active','on_leave','resigned','terminated') NULL, \`to_status\` enum ('active','on_leave','resigned','terminated') NOT NULL, \`effective_date\` date NOT NULL, \`reason\` text NULL, \`created_by\` varchar(36) NULL, INDEX \`IDX_employee_status_changes_employee\` (\`employee_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(`ALTER TABLE \`employee_status_changes\` ADD CONSTRAINT \`FK_employee_status_changes_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`employees\`(\`id\`) ON DELETE CASCADE`);
    await q.query(
      `CREATE TABLE \`employee_documents\` (${BASE}, \`employee_id\` varchar(36) NOT NULL, \`document_type\` enum ('contract','national_id','certificate','medical','other') NOT NULL DEFAULT 'other', \`title\` varchar(255) NOT NULL, \`original_name\` varchar(255) NOT NULL, \`stored_name\` varchar(255) NOT NULL, \`mime_type\` varchar(100) NOT NULL, \`size_bytes\` int NOT NULL DEFAULT 0, \`expiry_date\` date NULL, \`notes\` text NULL, \`created_by\` varchar(36) NULL, INDEX \`IDX_employee_documents_employee\` (\`employee_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(`ALTER TABLE \`employee_documents\` ADD CONSTRAINT \`FK_employee_documents_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`employees\`(\`id\`) ON DELETE CASCADE`);

    // ── salary structure ──
    await q.query(
      `CREATE TABLE \`pay_components\` (${BASE}, \`code\` varchar(50) NOT NULL, \`name\` varchar(255) NOT NULL, \`name_en\` varchar(255) NULL, \`component_type\` enum ('earning','deduction') NOT NULL, \`calc_type\` enum ('fixed','percent_of_basic') NOT NULL DEFAULT 'fixed', \`default_value\` decimal(18,2) NOT NULL DEFAULT 0, \`account_id\` varchar(36) NULL, \`is_basic\` tinyint NOT NULL DEFAULT 0, \`sort_order\` int NOT NULL DEFAULT 0, \`is_active\` tinyint NOT NULL DEFAULT 1, UNIQUE INDEX \`UQ_pay_components_code\` (\`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`salary_packages\` (${BASE}, \`employee_id\` varchar(36) NOT NULL, \`effective_from\` date NOT NULL, \`total_earnings\` decimal(18,2) NOT NULL DEFAULT 0, \`total_deductions\` decimal(18,2) NOT NULL DEFAULT 0, \`net_salary\` decimal(18,2) NOT NULL DEFAULT 0, \`notes\` text NULL, \`created_by\` varchar(36) NULL, INDEX \`IDX_salary_packages_employee\` (\`employee_id\`), UNIQUE INDEX \`UQ_salary_packages_employee_from\` (\`employee_id\`, \`effective_from\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(`ALTER TABLE \`salary_packages\` ADD CONSTRAINT \`FK_salary_packages_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`employees\`(\`id\`) ON DELETE CASCADE`);
    await q.query(
      `CREATE TABLE \`salary_package_lines\` (${BASE}, \`salary_package_id\` varchar(36) NOT NULL, \`pay_component_id\` varchar(36) NOT NULL, \`value\` decimal(18,2) NOT NULL DEFAULT 0, \`amount\` decimal(18,2) NOT NULL DEFAULT 0, INDEX \`IDX_salary_package_lines_package\` (\`salary_package_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(`ALTER TABLE \`salary_package_lines\` ADD CONSTRAINT \`FK_salary_package_lines_package\` FOREIGN KEY (\`salary_package_id\`) REFERENCES \`salary_packages\`(\`id\`) ON DELETE CASCADE`);
    await q.query(`ALTER TABLE \`salary_package_lines\` ADD CONSTRAINT \`FK_salary_package_lines_component\` FOREIGN KEY (\`pay_component_id\`) REFERENCES \`pay_components\`(\`id\`) ON DELETE RESTRICT`);

    // default components
    await q.query(
      `INSERT INTO \`pay_components\` (\`id\`, \`code\`, \`name\`, \`name_en\`, \`component_type\`, \`calc_type\`, \`is_basic\`, \`sort_order\`) VALUES
        (UUID(), 'BASIC', 'الراتب الأساسي', 'Basic salary', 'earning', 'fixed', 1, 1),
        (UUID(), 'TRANSPORT', 'بدل انتقال', 'Transport allowance', 'earning', 'fixed', 0, 2),
        (UUID(), 'HOUSING', 'بدل سكن', 'Housing allowance', 'earning', 'fixed', 0, 3),
        (UUID(), 'INSURANCE', 'تأمينات اجتماعية', 'Social insurance', 'deduction', 'fixed', 0, 10)`,
    );

    // existing net salary → package «أساسي»
    await q.query(
      `INSERT INTO \`salary_packages\` (\`id\`, \`employee_id\`, \`effective_from\`, \`total_earnings\`, \`total_deductions\`, \`net_salary\`, \`notes\`)
       SELECT UUID(), e.\`id\`, COALESCE(e.\`hire_date\`, CURDATE()), e.\`net_salary\`, 0, e.\`net_salary\`, 'محوّل من المرتب الصافي عند تفعيل الموارد البشرية'
         FROM \`employees\` e WHERE e.\`deleted_at\` IS NULL AND e.\`net_salary\` > 0`,
    );
    await q.query(
      `INSERT INTO \`salary_package_lines\` (\`id\`, \`salary_package_id\`, \`pay_component_id\`, \`value\`, \`amount\`)
       SELECT UUID(), sp.\`id\`, pc.\`id\`, sp.\`net_salary\`, sp.\`net_salary\`
         FROM \`salary_packages\` sp JOIN \`pay_components\` pc ON pc.\`code\` = 'BASIC'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE \`salary_package_lines\``);
    await q.query(`DROP TABLE \`salary_packages\``);
    await q.query(`DROP TABLE \`pay_components\``);
    await q.query(`DROP TABLE \`employee_documents\``);
    await q.query(`DROP TABLE \`employee_status_changes\``);
    await q.query(`ALTER TABLE \`departments\` DROP FOREIGN KEY \`FK_departments_manager\``);
    for (const fk of ['FK_employees_department', 'FK_employees_job_grade', 'FK_employees_direct_manager', 'FK_employees_user']) {
      await q.query(`ALTER TABLE \`employees\` DROP FOREIGN KEY \`${fk}\``);
    }
    await q.query(`DROP INDEX \`UQ_employees_user\` ON \`employees\``);
    await q.query(`ALTER TABLE \`employees\`
      DROP COLUMN \`department_id\`, DROP COLUMN \`job_grade_id\`, DROP COLUMN \`direct_manager_id\`, DROP COLUMN \`contract_type\`,
      DROP COLUMN \`contract_start\`, DROP COLUMN \`contract_end\`, DROP COLUMN \`birth_date\`, DROP COLUMN \`gender\`,
      DROP COLUMN \`marital_status\`, DROP COLUMN \`address\`, DROP COLUMN \`qualification\`, DROP COLUMN \`social_insurance_number\`,
      DROP COLUMN \`bank_name\`, DROP COLUMN \`bank_account_number\`, DROP COLUMN \`iban\`, DROP COLUMN \`emergency_contact_name\`,
      DROP COLUMN \`emergency_contact_relation\`, DROP COLUMN \`emergency_contact_mobile\`, DROP COLUMN \`employment_status\`,
      DROP COLUMN \`exit_date\`, DROP COLUMN \`exit_reason\`, DROP COLUMN \`user_id\`, DROP COLUMN \`photo_name\``);
    await q.query(`DROP TABLE \`job_grades\``);
    await q.query(`DROP TABLE \`departments\``);
  }
}
