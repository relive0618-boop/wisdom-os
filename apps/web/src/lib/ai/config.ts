export const DEFAULT_TIMEOUT_MS = 25_000;
export const DEFAULT_MAX_RETRIES = 1;

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function remoteConfig() {
  return {
    baseUrl: process.env.AI_BASE_URL?.trim() || null,
    apiKey: process.env.AI_API_KEY?.trim() || null,
    model: process.env.AI_MODEL?.trim() || null,
    timeoutMs: boundedInteger(process.env.AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 120_000),
    maxRetries: boundedInteger(process.env.AI_MAX_RETRIES, DEFAULT_MAX_RETRIES, 0, 1),
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
  };
}
