import { registerAs } from '@nestjs/config';

/**
 * AI ERP Assistant configuration. Consumed via `config.get('ai.<key>')`.
 * The OpenAI key is read ONLY from the environment — never hardcoded/committed.
 */
export default registerAs('ai', () => ({
  /** Feature flag — the /ai/chat endpoint returns 503 when no key is set. */
  enabled: !!process.env.OPENAI_API_KEY,
  openAiApiKey: process.env.OPENAI_API_KEY ?? '',
  model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  /** Max tool-calling round-trips per request (guards against loops/cost). */
  maxToolIterations: parseInt(process.env.AI_MAX_TOOL_ITERATIONS ?? '6', 10),
  /** Request timeout to OpenAI in ms. */
  requestTimeoutMs: parseInt(process.env.AI_REQUEST_TIMEOUT_MS ?? '60000', 10),
}));
