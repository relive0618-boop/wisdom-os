"use client";

import "client-only";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

let client: SupabaseClient | null | undefined;

export function getBrowserSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const config = supabaseConfig();
  client = config.configured ? createBrowserClient(config.url!, config.publishableKey!) : null;
  return client;
}
