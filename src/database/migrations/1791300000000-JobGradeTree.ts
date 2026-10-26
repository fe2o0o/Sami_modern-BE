import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Job grades become a hierarchy (org chart): each grade may report to a parent
 * grade. `level` is kept and recomputed from the depth (1 = top). Existing
 * grades start as top-level nodes. Additive.
 */
export class JobGradeTree1791300000000 implements MigrationInterface {
  name = 'JobGradeTree1791300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`job_grades\` ADD \`parent_id\` varchar(36) NULL`);
    await q.query(`CREATE INDEX \`IDX_job_grades_parent\` ON \`job_grades\` (\`parent_id\`)`);
    await q.query(
      `ALTER TABLE \`job_grades\` ADD CONSTRAINT \`FK_job_grades_parent\` FOREIGN KEY (\`parent_id\`) REFERENCES \`job_grades\`(\`id\`) ON DELETE SET NULL`,
    );
    await q.query(`UPDATE \`job_grades\` SET \`level\` = 1`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE \`job_grades\` DROP FOREIGN KEY \`FK_job_grades_parent\``);
    await q.query(`DROP INDEX \`IDX_job_grades_parent\` ON \`job_grades\``);
    await q.query(`ALTER TABLE \`job_grades\` DROP COLUMN \`parent_id\``);
  }
}
