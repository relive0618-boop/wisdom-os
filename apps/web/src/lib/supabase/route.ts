import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

export async function getRouteSupabaseClient(response: NextResponse): Promise<SupabaseClient | null> {
  const config = supabaseConfig();
  if (!config.configured) return null;
  const store = await cookies();
  return createServerClient(config.url!, config.publishableKey!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  });
}
