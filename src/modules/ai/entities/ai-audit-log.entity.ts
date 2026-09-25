import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';

/**
 * One AI assistant interaction, for audit/observability. Stores the message,
 * which tools ran, status, timing and token usage — never secrets or raw
 * sensitive payloads beyond the tool names.
 */
@Entity('ai_audit_logs')
export class AiAuditLog extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Index()
  @Column({ type: 'uuid' })
  conversationId!: string;

  @Column({ type: 'text' })
  userMessage!: string;

  @Column({ type: 'text', nullable: true })
  assistantMessage!: string | null;

  /** Comma-separated tool names invoked during this turn. */
  @Column({ type: 'varchar', length: 1000, nullable: true })
  toolsUsed!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model!: string | null;

  @Column({ type: 'int', nullable: true })
  promptTokens!: number | null;

  @Column({ type: 'int', nullable: true })
  completionTokens!: number | null;

  @Column({ type: 'int', nullable: true })
  totalTokens!: number | null;

  /** 'success' | 'error' */
  @Column({ type: 'varchar', length: 20, default: 'success' })
  status!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'int', nullable: true })
  durationMs!: number | null;
}
