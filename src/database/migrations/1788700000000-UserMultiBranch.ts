import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Users move from a single branch to a MANY-to-many `branches` set
 * (join table `user_branches`) that drives branch-scoped data access.
 *
 * - Creates `user_branches`.
 * - Migrates each existing `users.branch_id` into a join row.
 * - Drops the old `users.branch_id` (FK + index + column).
 *
 * A user with NO rows here has no branch-scoped access unless the role grants
 * `all_branches.view` (or is super-admin), which see every branch regardless.
 */
export class UserMultiBranch1788700000000 implements MigrationInterface {
  name = 'UserMultiBranch1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`user_branches\` (
        \`user_id\` varchar(36) NOT NULL,
        \`branch_id\` varchar(36) NOT NULL,
        PRIMARY KEY (\`user_id\`, \`branch_id\`),
        INDEX \`IDX_ub_user\` (\`user_id\`),
        INDEX \`IDX_ub_branch\` (\`branch_id\`),
        CONSTRAINT \`FK_ub_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT \`FK_ub_branch\` FOREIGN KEY (\`branch_id\`) REFERENCES \`branches\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      INSERT IGNORE INTO \`user_branches\` (\`user_id\`, \`branch_id\`)
      SELECT \`id\`, \`branch_id\` FROM \`users\` WHERE \`branch_id\` IS NOT NULL
    `);

    await queryRunner.query(
      `ALTER TABLE \`users\` DROP FOREIGN KEY \`FK_5a58f726a41264c8b3e86d4a1de\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP INDEX \`FK_5a58f726a41264c8b3e86d4a1de\``,
    );
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`branch_id\``);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`users\` ADD \`branch_id\` varchar(255) NULL`);

    // Restore one branch per user (the first link) as a best-effort reverse.
    await queryRunner.query(`
      UPDATE \`users\` u
      SET u.\`branch_id\` = (
        SELECT ub.\`branch_id\` FROM \`user_branches\` ub
        WHERE ub.\`user_id\` = u.\`id\` LIMIT 1
      )
    `);

    await queryRunner.query(
      `ALTER TABLE \`users\` ADD INDEX \`FK_5a58f726a41264c8b3e86d4a1de\` (\`branch_id\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD CONSTRAINT \`FK_5a58f726a41264c8b3e86d4a1de\` FOREIGN KEY (\`branch_id\`) REFERENCES \`branches\` (\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS \`user_branches\``);
  }
}
