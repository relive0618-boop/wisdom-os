import { supabaseConfig } from "./config";

export function serverSupabaseConfig() {
  const publicConfig = supabaseConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() || null;
  return { ...publicConfig, secretKey, flags: { ...publicConfig.flags, persistentRateLimitEnabled: process.env.WISDOM_PERSISTENT_RATE_LIMIT_ENABLED === "true" } };
}
