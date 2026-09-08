import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `code_settings` table (per-entity code-generation configuration).
 *
 * This table was previously only created by `synchronize` in development, so it
 * was missing on production — every `GET /code-settings` and `.../preview` call
 * hit a non-existent table, surfacing as a masked 400 "Database request failed".
 *
 * DDL mirrors exactly what `synchronize` produced in development. `IF NOT EXISTS`
 * keeps it safe to run on databases where the table already exists.
 */
export class CreateCodeSettings1788500000000 implements MigrationInterface {
  name = 'CreateCodeSettings1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`code_settings\` (
        \`id\` varchar(36) NOT NULL,
        \`entity_key\` varchar(50) NOT NULL,
        \`auto_generate\` tinyint NOT NULL DEFAULT 0,
        \`prefix\` varchar(20) NOT NULL DEFAULT '',
        \`padding\` int NOT NULL DEFAULT 4,
        \`next_number\` int NOT NULL DEFAULT 1,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uq_code_setting_entity\` (\`entity_key\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`code_settings\``);
  }
}
