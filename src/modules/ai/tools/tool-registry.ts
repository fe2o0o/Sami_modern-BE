import { Injectable, Logger } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import type OpenAI from 'openai';
import { AiExecutionContext, AiToolDefinition, AiToolResult } from '../types/ai.types';

/**
 * Central registry of AI tools. Domain providers register their tools here on
 * module init. The registry is the ONLY place a tool runs, so it is where the
 * server re-enforces authorization (the model calls services indirectly, which
 * bypasses controller guards) and sanitizes errors.
 */
@Injectable()
export class AiToolRegistry {
  private readonly logger = new Logger(AiToolRegistry.name);
  private readonly tools = new Map<string, AiToolDefinition>();

  register(defs: AiToolDefinition[]): void {
    for (const def of defs) {
      if (this.tools.has(def.name)) {
        throw new Error(`Duplicate AI tool registered: ${def.name}`);
      }
      this.tools.set(def.name, def);
    }
  }

  count(): number {
    return this.tools.size;
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /** True if this user may run the tool (super-admin or holds its permission). */
  private allowed(tool: AiToolDefinition, ctx: AiExecutionContext): boolean {
    if (!tool.permission) return true;
    return ctx.isSuperAdmin || ctx.permissions.includes(tool.permission);
  }

  /** OpenAI function-tool schemas — only the tools THIS user is authorized for. */
  openAiTools(ctx: AiExecutionContext): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return [...this.tools.values()]
      .filter((t) => this.allowed(t, ctx))
      .map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters as unknown as Record<string, unknown>,
        },
      }));
  }

  /** Execute a tool with server-side authorization + sanitized errors. */
  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: AiExecutionContext,
  ): Promise<AiToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, code: 'TOOL_NOT_FOUND', message: `أداة غير معروفة: ${name}` };
    }
    if (!this.allowed(tool, ctx)) {
      return {
        success: false,
        code: 'PERMISSION_DENIED',
        message: 'ليس لديك صلاحية لتنفيذ هذه العملية.',
      };
    }
    try {
      return await tool.handler(args ?? {}, ctx);
    } catch (err) {
      this.logger.warn(`AI tool "${name}" failed: ${(err as Error)?.message}`);
      return { success: false, code: 'TOOL_ERROR', message: this.friendlyError(err) };
    }
  }

  /** Convert an internal error into a safe, user-facing message (no leaks). */
  private friendlyError(err: unknown): string {
    if (err instanceof HttpException) {
      const res = err.getResponse() as string | { message?: string | string[] };
      if (typeof res === 'string') return res;
      const m = res?.message;
      if (Array.isArray(m)) return m.join('، ');
      if (typeof m === 'string') return m;
    }
    // Never surface SQL/stack/internal details to the model or user.
    return 'تعذّر تنفيذ العملية على البيانات المطلوبة.';
  }
}
