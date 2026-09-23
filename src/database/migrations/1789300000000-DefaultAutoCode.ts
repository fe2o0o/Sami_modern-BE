import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Auto-generated codes become the DEFAULT for every module: the `auto_generate`
 * column default flips to true, and all existing code-setting rows are enabled.
 * (Turn a specific entity back to manual from the Code Settings screen.)
 */
export class DefaultAutoCode1789300000000 implements MigrationInterface {
  name = 'DefaultAutoCode1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`code_settings\` MODIFY \`auto_generate\` tinyint NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(`UPDATE \`code_settings\` SET \`auto_generate\` = 1`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`code_settings\` MODIFY \`auto_generate\` tinyint NOT NULL DEFAULT 0`,
    );
  }
}
