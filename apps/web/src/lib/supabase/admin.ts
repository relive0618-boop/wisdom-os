import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverSupabaseConfig } from "./serverConfig";

export function getAdminSupabaseClient(): SupabaseClient | null {
  const config = serverSupabaseConfig();
  if (!config.url || !config.secretKey) return null;
  return createClient(config.url, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
