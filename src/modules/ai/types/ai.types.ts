/**
 * Shared types for the AI ERP Assistant.
 *
 * SECURITY: the AI model can never supply the execution context. It is built
 * on the server from the authenticated `request.user` and injected into every
 * tool. Model-provided companyId/userId/roles/permissions are ignored.
 */

/** Trusted, server-built context passed to every tool execution. */
export interface AiExecutionContext {
  userId: string;
  /** Branch access scope (null = all branches). The real isolation boundary. */
  branchScope: string[] | null;
  permissions: string[];
  isSuperAdmin: boolean;
  /** Backend runtime "now" — the source of truth for relative dates. */
  now: Date;
}

/** How a tool result should be rendered by the frontend. */
export type AiPresentationType =
  | 'text'
  | 'report'
  | 'table'
  | 'navigation'
  | 'ambiguous'
  | 'confirmation'
  | 'error';

/** Structured, machine-readable result returned by every tool. */
export type AiToolResult =
  | {
      success: true;
      /** Optional hint for how the payload is best displayed. */
      presentation?: AiPresentationType;
      data: unknown;
    }
  | {
      success: false;
      code: string;
      message: string;
    };

/** JSON-schema object describing a tool's parameters (OpenAI function params). */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** A single AI tool: schema the model sees + the server-side handler. */
export interface AiToolDefinition {
  name: string;
  description: string;
  /** Permission key required to run this tool (re-enforced server-side). */
  permission?: string;
  parameters: JsonSchema;
  handler: (args: Record<string, unknown>, ctx: AiExecutionContext) => Promise<AiToolResult>;
}

/** The final response shape returned to the frontend from /ai/chat. */
export interface AiChatResult {
  message: string;
  type: AiPresentationType;
  data: unknown;
  conversationId: string;
  /** Non-sensitive execution metadata (tools used, model, timing). */
  meta: {
    model: string;
    toolsUsed: string[];
    tokens?: { prompt: number; completion: number; total: number } | null;
    durationMs: number;
  };
}
