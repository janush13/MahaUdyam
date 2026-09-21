export type AiProvider = 'none' | 'anthropic';

export interface AiSettings {
  provider: AiProvider;
  apiKey?: string;
  model?: string;
}

/**
 * AI provider configuration only — no AI/RAG module exists yet, and this
 * step never calls any external AI API. Defaults to `provider: 'none'`, in
 * which case AI_API_KEY/AI_MODEL are not required at all (see
 * validation.ts) — development must not need external AI credentials just
 * to start.
 */
export const buildAiConfig = (): AiSettings => ({
  provider: (process.env.AI_PROVIDER as AiProvider) ?? 'none',
  apiKey: process.env.AI_API_KEY,
  model: process.env.AI_MODEL,
});
