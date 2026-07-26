import { supabaseConfig } from "./config";

const MIN_RATE_LIMIT_HASH_SECRET_LENGTH = 32;
type PersistentRateLimitReadinessConfig = {
  url: string | null;
  publishableKey: string | null;
  secretKey: string | null;
  flags: { persistentRateLimitEnabled: boolean };
};

function hasValidSupabaseUrl(value: string | null) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function persistentRateLimitReady(config: PersistentRateLimitReadinessConfig = serverSupabaseConfig(), hashSecret: string | null | undefined = process.env.RATE_LIMIT_HASH_SECRET) {
  return Boolean(
    config.flags.persistentRateLimitEnabled
    && hasValidSupabaseUrl(config.url)
    && config.publishableKey
    && config.secretKey
    && (hashSecret?.length ?? 0) >= MIN_RATE_LIMIT_HASH_SECRET_LENGTH,
  );
}

export function serverSupabaseConfig() {
  const publicConfig = supabaseConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() || null;
  return { ...publicConfig, secretKey, flags: { ...publicConfig.flags, persistentRateLimitEnabled: process.env.WISDOM_PERSISTENT_RATE_LIMIT_ENABLED === "true" } };
}
