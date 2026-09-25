import { MigrationInterface, QueryRunner } from 'typeorm';

/** Audit log for AI assistant interactions (message, tools, tokens, timing). */
export class AiAuditLogs1789800000000 implements MigrationInterface {
  name = 'AiAuditLogs1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`ai_audit_logs\` (
        \`id\` varchar(36) NOT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` timestamp(6) NULL,
        \`version\` int NOT NULL DEFAULT '1',
        \`user_id\` varchar(36) NOT NULL,
        \`conversation_id\` varchar(36) NOT NULL,
        \`user_message\` text NOT NULL,
        \`assistant_message\` text NULL,
        \`tools_used\` varchar(1000) NULL,
        \`model\` varchar(100) NULL,
        \`prompt_tokens\` int NULL,
        \`completion_tokens\` int NULL,
        \`total_tokens\` int NULL,
        \`status\` varchar(20) NOT NULL DEFAULT 'success',
        \`error_message\` varchar(500) NULL,
        \`duration_ms\` int NULL,
        INDEX \`IDX_ai_audit_user\` (\`user_id\`),
        INDEX \`IDX_ai_audit_conversation\` (\`conversation_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`ai_audit_logs\``);
  }
}
