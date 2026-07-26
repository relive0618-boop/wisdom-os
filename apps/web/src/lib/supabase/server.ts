import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";
export { claimsAreAdmin, claimsUserId } from "./claims";

export async function getServerSupabaseClient(): Promise<SupabaseClient | null> {
  const config = supabaseConfig();
  if (!config.configured) return null;
  const store = await cookies();
  return createServerClient(config.url!, config.publishableKey!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* Server Components cannot set cookies. */ }
      },
    },
  });
}

export async function getVerifiedClaims() {
  const client = await getServerSupabaseClient();
  if (!client) return { client: null, claims: null };
  const { data } = await client.auth.getClaims();
  return { client, claims: data?.claims ?? null };
}
