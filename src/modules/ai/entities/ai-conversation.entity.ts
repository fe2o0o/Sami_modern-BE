import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';

/**
 * A chat thread between a user and the AI assistant. Owns its messages
 * (ai_messages). Scoped to the user who created it — never shared.
 */
@Entity('ai_conversations')
export class AiConversation extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  /** Short title, derived from the first user message. */
  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /** Timestamp of the latest message — used to sort the conversation list. */
  @Index()
  @Column({ type: 'timestamp', nullable: true })
  lastMessageAt!: Date | null;
}
