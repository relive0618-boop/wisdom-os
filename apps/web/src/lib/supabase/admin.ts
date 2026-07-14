import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

export function getAdminSupabaseClient(): SupabaseClient | null {
  const config = supabaseConfig();
  if (!config.url || !config.secretKey) return null;
  return createClient(config.url, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
