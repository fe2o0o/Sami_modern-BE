import { MigrationInterface, QueryRunner } from 'typeorm';

const BASE = `\`id\` varchar(36) NOT NULL, \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` timestamp(6) NULL, \`version\` int NOT NULL DEFAULT '1'`;

/**
 * Mini HR — phase 4: location-based attendance + the employee app (mobile + PIN).
 *  - attendance_shifts / attendance_holidays / attendance_punches;
 *  - branches.attendance_radius_m (the geofence; lat/lng columns already exist);
 *  - employees: shift, app access, PIN hash, failed-PIN lock.
 * Additive only — no existing data is changed.
 */
export class AttendancePhase41792900000000 implements MigrationInterface {
  name = 'AttendancePhase41792900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE \`attendance_shifts\` (${BASE}, \`name\` varchar(150) NOT NULL, \`start_time\` varchar(5) NOT NULL, \`end_time\` varchar(5) NOT NULL, \`late_grace_minutes\` int NOT NULL DEFAULT 15, \`early_leave_grace_minutes\` int NOT NULL DEFAULT 0, \`overtime_after_minutes\` int NOT NULL DEFAULT 30, \`weekly_off_days\` text NOT NULL, \`is_default\` tinyint NOT NULL DEFAULT 0, \`is_active\` tinyint NOT NULL DEFAULT 1, \`notes\` text NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`attendance_holidays\` (${BASE}, \`holiday_date\` date NOT NULL, \`name\` varchar(150) NOT NULL, \`branch_id\` varchar(36) NULL, INDEX \`IDX_attendance_holidays_date\` (\`holiday_date\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`attendance_punches\` (${BASE}, \`employee_id\` varchar(36) NOT NULL, \`punch_type\` enum ('in','out') NOT NULL, \`punched_at\` datetime(3) NOT NULL, \`work_date\` date NOT NULL, \`local_time\` varchar(8) NOT NULL, \`source\` enum ('mobile','manual','device') NOT NULL DEFAULT 'mobile', \`status\` enum ('accepted','rejected','voided') NOT NULL DEFAULT 'accepted', \`reject_reason\` varchar(255) NULL, \`latitude\` decimal(10,7) NULL, \`longitude\` decimal(10,7) NULL, \`accuracy_m\` decimal(10,2) NULL, \`distance_m\` decimal(10,2) NULL, \`branch_id\` varchar(36) NULL, \`branch_name\` varchar(255) NULL, \`shift_id\` varchar(36) NULL, \`device_info\` varchar(255) NULL, \`note\` text NULL, \`created_by_user_id\` varchar(36) NULL, \`voided_at\` datetime NULL, \`voided_by_user_id\` varchar(36) NULL, \`void_reason\` text NULL, INDEX \`IDX_attendance_punches_employee_date\` (\`employee_id\`, \`work_date\`), INDEX \`IDX_attendance_punches_work_date\` (\`work_date\`), INDEX \`IDX_attendance_punches_status\` (\`status\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await q.query(
      `ALTER TABLE \`attendance_punches\` ADD CONSTRAINT \`FK_attendance_punches_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`employees\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    if (!(await q.hasColumn('branches', 'attendance_radius_m'))) {
      await q.query(`ALTER TABLE \`branches\` ADD \`attendance_radius_m\` int NOT NULL DEFAULT 100`);
    }
    const cols: [string, string][] = [
      ['shift_id', 'varchar(36) NULL'],
      ['attendance_enabled', 'tinyint NOT NULL DEFAULT 0'],
      ['attendance_pin_hash', 'varchar(255) NULL'],
      ['attendance_pin_changed_at', 'datetime NULL'],
      ['attendance_pin_failed_count', 'int NOT NULL DEFAULT 0'],
      ['attendance_locked_until', 'datetime NULL'],
    ];
    for (const [c, def] of cols) {
      if (!(await q.hasColumn('employees', c))) await q.query(`ALTER TABLE \`employees\` ADD \`${c}\` ${def}`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const c of ['attendance_locked_until', 'attendance_pin_failed_count', 'attendance_pin_changed_at', 'attendance_pin_hash', 'attendance_enabled', 'shift_id']) {
      if (await q.hasColumn('employees', c)) await q.query(`ALTER TABLE \`employees\` DROP COLUMN \`${c}\``);
    }
    if (await q.hasColumn('branches', 'attendance_radius_m')) await q.query(`ALTER TABLE \`branches\` DROP COLUMN \`attendance_radius_m\``);
    await q.query(`DROP TABLE IF EXISTS \`attendance_punches\``);
    await q.query(`DROP TABLE IF EXISTS \`attendance_holidays\``);
    await q.query(`DROP TABLE IF EXISTS \`attendance_shifts\``);
  }
}
