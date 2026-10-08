import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiConversation } from './entities/ai-conversation.entity';
import { AiMessage } from './entities/ai-message.entity';

/** How many prior messages of a thread are replayed to the model for context. */
const HISTORY_LIMIT = 12;

export interface RecordedTurn {
  userMessage: string;
  assistantMessage: string;
  type: string | null;
  data: unknown | null;
  toolsUsed: string[];
}

/**
 * Owns AI conversation threads + their messages. Every read/write is scoped to
 * the requesting user — a user can only ever see or continue their own threads.
 */
@Injectable()
export class AiConversationService {
  constructor(
    @InjectRepository(AiConversation)
    private readonly conversations: Repository<AiConversation>,
    @InjectRepository(AiMessage)
    private readonly messages: Repository<AiMessage>,
  ) {}

  /**
   * Return the user's conversation for `conversationId` (if it exists and they
   * own it), otherwise create a fresh one titled from the first message.
   * Never trusts a client-supplied id to point at another user's thread.
   */
  async getOrCreate(
    userId: string,
    conversationId: string | undefined,
    firstMessage: string,
  ): Promise<AiConversation> {
    if (conversationId) {
      const existing = await this.conversations.findOne({
        where: { id: conversationId, userId },
      });
      if (existing) return existing;
    }
    return this.conversations.save(
      this.conversations.create({
        userId,
        title: this.titleFrom(firstMessage),
        lastMessageAt: new Date(),
      }),
    );
  }

  /** Prior messages (oldest→newest) to seed model context, capped for cost. */
  async history(conversationId: string): Promise<AiMessage[]> {
    const rows = await this.messages.find({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      take: HISTORY_LIMIT,
    });
    return rows.reverse();
  }

  /** Persist one user+assistant turn and bump the thread's activity time. */
  async record(conversation: AiConversation, turn: RecordedTurn): Promise<void> {
    await this.messages.save([
      this.messages.create({
        conversationId: conversation.id,
        role: 'user',
        content: turn.userMessage,
      }),
      this.messages.create({
        conversationId: conversation.id,
        role: 'assistant',
        content: turn.assistantMessage,
        type: turn.type,
        data: turn.data ?? null,
        toolsUsed: turn.toolsUsed.length ? turn.toolsUsed.join(',').slice(0, 1000) : null,
      }),
    ]);
    await this.conversations.update(conversation.id, { lastMessageAt: new Date() });
  }

  /** The user's conversation threads, most recently active first. */
  list(userId: string): Promise<AiConversation[]> {
    return this.conversations.find({
      where: { userId },
      order: { lastMessageAt: 'DESC' },
      take: 100,
    });
  }

  /** All messages of a thread the user owns (for reopening it). */
  async messagesOf(userId: string, conversationId: string): Promise<AiMessage[]> {
    await this.ownedOrThrow(userId, conversationId);
    return this.messages.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  /** Soft-delete a thread (and its messages) the user owns. */
  async remove(userId: string, conversationId: string): Promise<void> {
    await this.ownedOrThrow(userId, conversationId);
    await this.messages.softDelete({ conversationId });
    await this.conversations.softDelete({ id: conversationId });
  }

  private async ownedOrThrow(userId: string, conversationId: string): Promise<AiConversation> {
    const conv = await this.conversations.findOne({ where: { id: conversationId, userId } });
    if (!conv) throw new NotFoundException('المحادثة غير موجودة');
    return conv;
  }

  private titleFrom(message: string): string {
    const clean = message.replace(/\s+/g, ' ').trim();
    return (clean.length > 80 ? clean.slice(0, 80) + '…' : clean) || 'محادثة جديدة';
  }
}
