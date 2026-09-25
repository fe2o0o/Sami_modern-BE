import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';

/**
 * A single turn in an AI conversation. `role` is 'user' or 'assistant'.
 * Assistant turns may carry a presentation `type` + structured `data` so the
 * UI can re-render tables/reports when a past conversation is reopened.
 */
@Entity('ai_messages')
export class AiMessage extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  conversationId!: string;

  /** 'user' | 'assistant' */
  @Column({ type: 'varchar', length: 20 })
  role!: string;

  @Column({ type: 'text' })
  content!: string;

  /** Presentation hint for assistant turns (text/report/table/navigation/...). */
  @Column({ type: 'varchar', length: 20, nullable: true })
  type!: string | null;

  /** Structured tool payload for assistant turns (for re-rendering). */
  @Column({ type: 'json', nullable: true })
  data!: unknown | null;

  /** Comma-separated tool names invoked in this turn (assistant). */
  @Column({ type: 'varchar', length: 1000, nullable: true })
  toolsUsed!: string | null;
}
