import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bank accounts move from a single branch to MANY branches.
 *
 * - Creates the `bank_account_branches` join table.
 * - Migrates each existing `bank_accounts.branch_id` into a join row.
 * - Drops the now-obsolete `branch_id` (FK + index + column) and `is_default`
 *   (the per-branch default concept is removed).
 *
 * An account with NO join rows means "available to all branches".
 */
export class BankAccountMultiBranch1788600000000 implements MigrationInterface {
  name = 'BankAccountMultiBranch1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`bank_account_branches\` (
        \`bank_account_id\` varchar(36) NOT NULL,
        \`branch_id\` varchar(36) NOT NULL,
        PRIMARY KEY (\`bank_account_id\`, \`branch_id\`),
        INDEX \`IDX_bab_bank_account\` (\`bank_account_id\`),
        INDEX \`IDX_bab_branch\` (\`branch_id\`),
        CONSTRAINT \`FK_bab_bank_account\` FOREIGN KEY (\`bank_account_id\`) REFERENCES \`bank_accounts\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT \`FK_bab_branch\` FOREIGN KEY (\`branch_id\`) REFERENCES \`branches\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB
    `);

    // Carry existing single-branch assignments into the join table.
    await queryRunner.query(`
      INSERT IGNORE INTO \`bank_account_branches\` (\`bank_account_id\`, \`branch_id\`)
      SELECT \`id\`, \`branch_id\` FROM \`bank_accounts\` WHERE \`branch_id\` IS NOT NULL
    `);

    // Drop the old single-branch FK + index + column, and the default flag.
    await queryRunner.query(
      `ALTER TABLE \`bank_accounts\` DROP FOREIGN KEY \`FK_857203fb13222066f317ec93fa8\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`bank_accounts\` DROP INDEX \`IDX_857203fb13222066f317ec93fa\``,
    );
    await queryRunner.query(`ALTER TABLE \`bank_accounts\` DROP COLUMN \`branch_id\``);
    await queryRunner.query(`ALTER TABLE \`bank_accounts\` DROP COLUMN \`is_default\``);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add the columns (branch_id kept NULLABLE: accounts created as
    // all-branches have no single branch to restore).
    await queryRunner.query(
      `ALTER TABLE \`bank_accounts\` ADD \`branch_id\` varchar(255) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bank_accounts\` ADD \`is_default\` tinyint NOT NULL DEFAULT 0`,
    );

    // Restore one branch per account (the first link) as a best-effort reverse.
    await queryRunner.query(`
      UPDATE \`bank_accounts\` b
      SET b.\`branch_id\` = (
        SELECT bab.\`branch_id\` FROM \`bank_account_branches\` bab
        WHERE bab.\`bank_account_id\` = b.\`id\` LIMIT 1
      )
    `);

    await queryRunner.query(
      `ALTER TABLE \`bank_accounts\` ADD INDEX \`IDX_857203fb13222066f317ec93fa\` (\`branch_id\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bank_accounts\` ADD CONSTRAINT \`FK_857203fb13222066f317ec93fa8\` FOREIGN KEY (\`branch_id\`) REFERENCES \`branches\` (\`id\`) ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS \`bank_account_branches\``);
  }
}
