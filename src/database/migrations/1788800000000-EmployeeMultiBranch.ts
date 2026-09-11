import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Employees move from a single branch to a MANY-to-many `branches` set
 * (join table `employee_branches`). An employee with NO rows here is available
 * to all branches (e.g. a sales rep who serves every branch).
 *
 * `employees.branch_id` was a plain column (no FK/index), so it is simply
 * migrated into the join table and dropped.
 */
export class EmployeeMultiBranch1788800000000 implements MigrationInterface {
  name = 'EmployeeMultiBranch1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`employee_branches\` (
        \`employee_id\` varchar(36) NOT NULL,
        \`branch_id\` varchar(36) NOT NULL,
        PRIMARY KEY (\`employee_id\`, \`branch_id\`),
        INDEX \`IDX_eb_employee\` (\`employee_id\`),
        INDEX \`IDX_eb_branch\` (\`branch_id\`),
        CONSTRAINT \`FK_eb_employee\` FOREIGN KEY (\`employee_id\`) REFERENCES \`employees\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT \`FK_eb_branch\` FOREIGN KEY (\`branch_id\`) REFERENCES \`branches\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      INSERT IGNORE INTO \`employee_branches\` (\`employee_id\`, \`branch_id\`)
      SELECT \`id\`, \`branch_id\` FROM \`employees\` WHERE \`branch_id\` IS NOT NULL
    `);

    await queryRunner.query(`ALTER TABLE \`employees\` DROP COLUMN \`branch_id\``);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`employees\` ADD \`branch_id\` varchar(255) NULL`);

    await queryRunner.query(`
      UPDATE \`employees\` e
      SET e.\`branch_id\` = (
        SELECT eb.\`branch_id\` FROM \`employee_branches\` eb
        WHERE eb.\`employee_id\` = e.\`id\` LIMIT 1
      )
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS \`employee_branches\``);
  }
}
