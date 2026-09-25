import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { AiConversationService } from './ai-conversation.service';
import { ChatDto } from './dto/chat.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BranchScope } from '../auth/decorators/branch-scope.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AiExecutionContext } from './types/ai.types';

/**
 * AI ERP Assistant. Any authenticated user may chat; each tool the assistant
 * calls re-enforces its own permission and the caller's branch scope, so the
 * assistant can never read data the user isn't allowed to see. Conversation
 * threads are private to the user who created them.
 */
@ApiTags('AI Assistant')
@ApiBearerAuth('access-token')
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly conversations: AiConversationService,
  ) {}

  @Post('chat')
  @ResponseMessage('تمت معالجة الطلب')
  @ApiOperation({ summary: 'محادثة مع مساعد ERP الذكي (قراءة فقط)' })
  chat(
    @Body() dto: ChatDto,
    @CurrentUser() user: AuthenticatedUser,
    @BranchScope() branchScope: string[] | null,
  ) {
    const ctx: AiExecutionContext = {
      userId: user.userId,
      branchScope,
      permissions: user.permissions ?? [],
      isSuperAdmin: user.isSuperAdmin,
      now: new Date(),
    };
    return this.ai.chat(dto.message, dto.conversationId, ctx);
  }

  @Get('conversations')
  @ResponseMessage('تم جلب المحادثات')
  @ApiOperation({ summary: 'قائمة محادثات المستخدم الحالي' })
  async listConversations(@CurrentUser() user: AuthenticatedUser) {
    const rows = await this.conversations.list(user.userId);
    return rows.map((c) => ({
      id: c.id,
      title: c.title,
      lastMessageAt: c.lastMessageAt,
      createdAt: c.createdAt,
    }));
  }

  @Get('conversations/:id')
  @ResponseMessage('تم جلب المحادثة')
  @ApiOperation({ summary: 'رسائل محادثة معيّنة (يملكها المستخدم)' })
  async getConversation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const rows = await this.conversations.messagesOf(user.userId, id);
    return {
      conversationId: id,
      messages: rows.map((m) => ({
        role: m.role,
        text: m.content,
        type: m.type,
        data: m.data ?? null,
        toolsUsed: m.toolsUsed ? m.toolsUsed.split(',') : [],
        createdAt: m.createdAt,
      })),
    };
  }

  @Delete('conversations/:id')
  @HttpCode(200)
  @ResponseMessage('تم حذف المحادثة')
  @ApiOperation({ summary: 'حذف محادثة (يملكها المستخدم)' })
  async deleteConversation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.conversations.remove(user.userId, id);
    return { id };
  }
}
