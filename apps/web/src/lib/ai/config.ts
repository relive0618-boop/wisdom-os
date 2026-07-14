export const DEFAULT_TIMEOUT_MS = 25_000;
export const DEFAULT_MAX_RETRIES = 1;
export const DEFAULT_MAX_OUTPUT_TOKENS = 1_800;
export const DEFAULT_RESPONSE_FORMAT_MODE = "prompt" as const;
export const DEFAULT_TOTAL_BUDGET_MS = 45_000;
export const DEFAULT_THINKING_MODE = "provider_default" as const;

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function responseFormatMode(value: string | undefined) {
  return value === "json_object" ? "json_object" : DEFAULT_RESPONSE_FORMAT_MODE;
}

function thinkingMode(value: string | undefined) {
  if (value === "off" || value === "on") return value;
  return DEFAULT_THINKING_MODE;
}

export function remoteConfig() {
  return {
    baseUrl: process.env.AI_BASE_URL?.trim() || null,
    apiKey: process.env.AI_API_KEY?.trim() || null,
    model: process.env.AI_MODEL?.trim() || null,
    timeoutMs: boundedInteger(process.env.AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 120_000),
    maxRetries: boundedInteger(process.env.AI_MAX_RETRIES, DEFAULT_MAX_RETRIES, 0, 1),
    maxOutputTokens: boundedInteger(process.env.AI_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS, 800, 4_000),
    responseFormatMode: responseFormatMode(process.env.AI_RESPONSE_FORMAT_MODE),
    totalBudgetMs: boundedInteger(process.env.AI_TOTAL_BUDGET_MS, DEFAULT_TOTAL_BUDGET_MS, 15_000, 55_000),
    thinkingMode: thinkingMode(process.env.AI_THINKING_MODE),
  };
}

export function publicRemoteConfig() {
  const config = remoteConfig();
  let safeBaseUrl: string | null = null;
  if (config.baseUrl) {
    try {
      const parsed = new URL(config.baseUrl);
      parsed.search = "";
      parsed.hash = "";
      parsed.username = "";
      parsed.password = "";
      safeBaseUrl = parsed.toString();
    } catch {
      safeBaseUrl = null;
    }
  }
  return {
    configured: Boolean(config.baseUrl && config.apiKey && config.model),
    apiKeyConfigured: Boolean(config.apiKey),
    provider: config.baseUrl ? "openai-compatible" : null,
    safeBaseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    maxOutputTokens: config.maxOutputTokens,
    responseFormatMode: config.responseFormatMode,
    totalBudgetMs: config.totalBudgetMs,
    thinkingMode: config.thinkingMode,
  };
}
