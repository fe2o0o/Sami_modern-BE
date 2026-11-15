import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';

const BASE = `\`id\` varchar(36) NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` timestamp(6) NULL, \`version\` int NOT NULL DEFAULT '1'`;

/**
 * «طلبات الإذن» (mission / personal permission) + company attendance settings
 * (monthly cap of personal-permission hours, default 4). Additive only.
 */
export class AttendancePermissions1793200000000 implements MigrationInterface {
  name = 'AttendancePermissions1793200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE \`attendance_permissions\` (${BASE}, \`employee_id\` varchar(36) NOT NULL, \`permission_type\` enum ('mission','personal') NOT NULL, \`permission_date\` date NOT NULL, \`full_day\` tinyint NOT NULL DEFAULT 0, \`from_time\` varchar(5) NULL, \`to_time\` varchar(5) NULL, \`minutes\` int NOT NULL DEFAULT 0, \`reason\` text NULL, \`status\` enum ('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending', \`source\` enum ('app','erp') NOT NULL DEFAULT 'app', \`created_by_user_id\` varchar(36) NULL, \`decided_by_user_id\` varchar(36) NULL, \`decided_at\` datetime NULL, \`decision_note\` text NULL, INDEX \`IDX_attendance_permissions_employee_date\` (\`employee_id\`, \`permission_date\`), INDEX \`IDX_attendance_permissions_status\` (\`status\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(
      `ALTER TABLE \`attendance_permissions\` ADD CONSTRAINT \`FK_attendance_permissions_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`employees\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(`CREATE TABLE \`attendance_settings\` (${BASE}, \`personal_permission_hours_per_month\` decimal(5,1) NULL DEFAULT 4, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    await q.query('INSERT INTO `attendance_settings` (`id`, `personal_permission_hours_per_month`) VALUES (?, 4)', [randomUUID()]);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS `attendance_settings`');
    await q.query('DROP TABLE IF EXISTS `attendance_permissions`');
  }
}
