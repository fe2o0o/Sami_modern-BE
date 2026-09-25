import { MigrationInterface, QueryRunner } from 'typeorm';

/** Conversation threads + messages for the AI assistant (chat history). */
export class AiConversations1789900000000 implements MigrationInterface {
  name = 'AiConversations1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`ai_conversations\` (
        \`id\` varchar(36) NOT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` timestamp(6) NULL,
        \`version\` int NOT NULL DEFAULT '1',
        \`user_id\` varchar(36) NOT NULL,
        \`title\` varchar(200) NOT NULL,
        \`last_message_at\` timestamp NULL,
        INDEX \`IDX_ai_conv_user\` (\`user_id\`),
        INDEX \`IDX_ai_conv_last_message\` (\`last_message_at\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE \`ai_messages\` (
        \`id\` varchar(36) NOT NULL,
        \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`deleted_at\` timestamp(6) NULL,
        \`version\` int NOT NULL DEFAULT '1',
        \`conversation_id\` varchar(36) NOT NULL,
        \`role\` varchar(20) NOT NULL,
        \`content\` text NOT NULL,
        \`type\` varchar(20) NULL,
        \`data\` json NULL,
        \`tools_used\` varchar(1000) NULL,
        INDEX \`IDX_ai_msg_conversation\` (\`conversation_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`ai_messages\``);
    await queryRunner.query(`DROP TABLE \`ai_conversations\``);
  }
}
