import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Branch / warehouse manager becomes a link to an EMPLOYEE (for the coming HR
 * module) instead of free text. `manager_name` stays as the display snapshot
 * (kept in sync by the services) so lists, exports and history are unchanged.
 * Backfill: an existing manager name that matches exactly ONE active employee
 * is linked to that employee; anything else keeps its text only.
 */
export class BranchWarehouseManagerEmployee1791000000000 implements MigrationInterface {
  name = 'BranchWarehouseManagerEmployee1791000000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of ['branches', 'warehouses']) {
      await q.query(`ALTER TABLE \`${table}\` ADD \`manager_employee_id\` varchar(36) NULL`);
      await q.query(
        `ALTER TABLE \`${table}\` ADD CONSTRAINT \`FK_${table}_manager_employee\` FOREIGN KEY (\`manager_employee_id\`) REFERENCES \`employees\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
      );
      await q.query(
        `UPDATE \`${table}\` t
           JOIN (SELECT TRIM(name) AS name, MIN(id) AS id FROM \`employees\`
                  WHERE deleted_at IS NULL GROUP BY TRIM(name) HAVING COUNT(*) = 1) e
             ON e.name = TRIM(t.manager_name)
            SET t.manager_employee_id = e.id
          WHERE t.manager_name IS NOT NULL AND TRIM(t.manager_name) <> ''`,
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['branches', 'warehouses']) {
      await q.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`FK_${table}_manager_employee\``);
      await q.query(`ALTER TABLE \`${table}\` DROP COLUMN \`manager_employee_id\``);
    }
  }
}
