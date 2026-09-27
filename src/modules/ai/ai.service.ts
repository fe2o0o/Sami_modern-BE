import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { AiToolRegistry } from './tools/tool-registry';
import { AiAuditLog } from './entities/ai-audit-log.entity';
import { AiConversationService } from './ai-conversation.service';
import { AiConversation } from './entities/ai-conversation.entity';
import { buildSystemPrompt } from './prompts/system.prompt';
import { AiChatResult, AiExecutionContext, AiPresentationType } from './types/ai.types';
import { CustomerAiTools } from './tools/customer.tools';
import { SupplierAiTools } from './tools/supplier.tools';
import { SalesAiTools } from './tools/sales.tools';
import { PurchaseAiTools } from './tools/purchase.tools';
import { InventoryAiTools } from './tools/inventory.tools';
import { FinanceAiTools } from './tools/finance.tools';
import { AccountingAiTools } from './tools/accounting.tools';
import { ContextAiTools } from './tools/context.tools';
import { NavigationAiTools } from './tools/navigation.tools';
import { VoucherAiTools } from './tools/voucher.tools';
import { ReferenceAiTools } from './tools/reference.tools';

/** Max characters of a single tool result fed back to the model (cost guard). */
const MAX_TOOL_RESULT_CHARS = 12000;

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private client: OpenAI | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: AiToolRegistry,
    private readonly conversations: AiConversationService,
    @InjectRepository(AiAuditLog) private readonly auditRepo: Repository<AiAuditLog>,
    private readonly customerTools: CustomerAiTools,
    private readonly supplierTools: SupplierAiTools,
    private readonly salesTools: SalesAiTools,
    private readonly purchaseTools: PurchaseAiTools,
    private readonly inventoryTools: InventoryAiTools,
    private readonly financeTools: FinanceAiTools,
    private readonly accountingTools: AccountingAiTools,
    private readonly contextTools: ContextAiTools,
    private readonly navigationTools: NavigationAiTools,
    private readonly voucherTools: VoucherAiTools,
    private readonly referenceTools: ReferenceAiTools,
  ) {}

  /** Register all domain tools once the module is ready. */
  onModuleInit(): void {
    this.registry.register(this.customerTools.defs());
    this.registry.register(this.supplierTools.defs());
    this.registry.register(this.salesTools.defs());
    this.registry.register(this.purchaseTools.defs());
    this.registry.register(this.inventoryTools.defs());
    this.registry.register(this.financeTools.defs());
    this.registry.register(this.accountingTools.defs());
    this.registry.register(this.contextTools.defs());
    this.registry.register(this.navigationTools.defs());
    this.registry.register(this.voucherTools.defs());
    this.registry.register(this.referenceTools.defs());
    this.logger.log(`AI assistant ready with ${this.registry.count()} tools.`);
  }

  isEnabled(): boolean {
    return !!this.config.get<boolean>('ai.enabled');
  }

  private openai(): OpenAI {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('مساعد الذكاء الاصطناعي غير مُفعّل (لم يتم ضبط مفتاح OpenAI).');
    }
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.config.get<string>('ai.openAiApiKey'),
        timeout: this.config.get<number>('ai.requestTimeoutMs') ?? 60000,
      });
    }
    return this.client;
  }

  /** Main entry: run one user turn through the model + tools. */
  async chat(message: string, conversationId: string | undefined, ctx: AiExecutionContext): Promise<AiChatResult> {
    const started = Date.now();
    const model = this.config.get<string>('ai.model') ?? 'gpt-4o-mini';
    const maxIter = this.config.get<number>('ai.maxToolIterations') ?? 6;
    const client = this.openai();

    // Resolve (or create) the thread and replay its recent history for context.
    const conversation = await this.conversations.getOrCreate(ctx.userId, conversationId, message);
    const convId = conversation.id;
    const priorMessages = await this.conversations.history(convId);

    const tools = this.registry.openAiTools(ctx);
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt(ctx) },
      ...priorMessages.map((m) =>
        m.role === 'assistant'
          ? ({ role: 'assistant', content: m.content } as const)
          : ({ role: 'user', content: m.content } as const),
      ),
      { role: 'user', content: message },
    ];

    const toolsUsed: string[] = [];
    const tokens = { prompt: 0, completion: 0, total: 0 };
    /** Every structured tool result of this turn (a repeated tool replaces its earlier result). */
    const structured: { tool: string; type: AiPresentationType; data: unknown }[] = [];
    let finalText = '';

    try {
      for (let i = 0; i < maxIter; i++) {
        const completion = await client.chat.completions.create({
          model,
          messages,
          tools: tools.length ? tools : undefined,
          tool_choice: tools.length ? 'auto' : undefined,
          temperature: 0.1,
        });
        if (completion.usage) {
          tokens.prompt += completion.usage.prompt_tokens ?? 0;
          tokens.completion += completion.usage.completion_tokens ?? 0;
          tokens.total += completion.usage.total_tokens ?? 0;
        }
        const choice = completion.choices[0]?.message;
        if (!choice) break;
        messages.push(choice);

        if (choice.tool_calls?.length) {
          for (const call of choice.tool_calls) {
            if (call.type !== 'function') continue;
            const name = call.function.name;
            let args: Record<string, unknown> = {};
            try {
              args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
            } catch {
              args = {};
            }
            toolsUsed.push(name);
            const result = await this.registry.execute(name, args, ctx);
            if (result.success && result.presentation && result.presentation !== 'text') {
              const idx = structured.findIndex((s) => s.tool === name);
              const entry = { tool: name, type: result.presentation, data: result.data };
              if (idx >= 0) structured[idx] = entry;
              else structured.push(entry);
            }
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: this.capResult(JSON.stringify(result)),
            });
          }
          continue; // let the model read the tool results
        }

        finalText = (choice.content as string) ?? '';
        break;
      }

      if (!finalText) {
        finalText = 'تم تنفيذ الطلب. إن احتجت تفاصيل إضافية أخبرني.';
      }

      // One structured result → as is. Several → bundle them so the UI renders each.
      const single = structured.length === 1 ? structured[0] : null;
      const result: AiChatResult = {
        message: finalText,
        type: single ? single.type : structured.length > 1 ? 'report' : 'text',
        data: single ? single.data : structured.length > 1 ? { __responses: structured } : null,
        conversationId: convId,
        meta: { model, toolsUsed, tokens, durationMs: Date.now() - started },
      };
      await this.persistTurn(conversation, message, result, toolsUsed);
      await this.audit(convId, message, ctx, result, model, tokens, toolsUsed, 'success', null, Date.now() - started);
      return result;
    } catch (err) {
      const durationMs = Date.now() - started;
      this.logger.error(`AI chat failed: ${(err as Error)?.message}`);
      await this.audit(convId, message, ctx, null, model, tokens, toolsUsed, 'error', (err as Error)?.message ?? 'error', durationMs);
      if (err instanceof ServiceUnavailableException) throw err;
      return {
        message: 'تعذّر الوصول إلى مساعد الذكاء الاصطناعي حالياً، حاول مرة أخرى بعد قليل.',
        type: 'error',
        data: null,
        conversationId: convId,
        meta: { model, toolsUsed, tokens: null, durationMs },
      };
    }
  }

  /** Best-effort persistence of a completed turn (never fails the request). */
  private async persistTurn(
    conversation: AiConversation,
    userMessage: string,
    result: AiChatResult,
    toolsUsed: string[],
  ): Promise<void> {
    try {
      await this.conversations.record(conversation, {
        userMessage,
        assistantMessage: result.message,
        type: result.type,
        data: result.data ?? null,
        toolsUsed,
      });
    } catch (e) {
      this.logger.warn(`AI conversation persist failed: ${(e as Error)?.message}`);
    }
  }

  private capResult(json: string): string {
    if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
    return json.slice(0, MAX_TOOL_RESULT_CHARS) + '…"[truncated]"';
  }

  /** Best-effort audit write (never fails the request). */
  private async audit(
    conversationId: string,
    userMessage: string,
    ctx: AiExecutionContext,
    result: AiChatResult | null,
    model: string,
    tokens: { prompt: number; completion: number; total: number },
    toolsUsed: string[],
    status: string,
    errorMessage: string | null,
    durationMs: number,
  ): Promise<void> {
    try {
      await this.auditRepo.save(
        this.auditRepo.create({
          userId: ctx.userId,
          conversationId,
          userMessage,
          assistantMessage: result?.message ?? null,
          toolsUsed: toolsUsed.length ? toolsUsed.join(',').slice(0, 1000) : null,
          model,
          promptTokens: tokens.prompt || null,
          completionTokens: tokens.completion || null,
          totalTokens: tokens.total || null,
          status,
          errorMessage: errorMessage ? errorMessage.slice(0, 500) : null,
          durationMs,
        }),
      );
    } catch (e) {
      this.logger.warn(`AI audit log failed: ${(e as Error)?.message}`);
    }
  }
}
