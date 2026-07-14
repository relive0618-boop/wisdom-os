import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "./config";

export async function updateAuthSession(request: NextRequest) {
  const config = supabaseConfig();
  let response = NextResponse.next({ request });
  if (!config.configured) return { response, claims: null };
  const supabase = createServerClient(config.url!, config.publishableKey!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  return { response, claims: data?.claims ?? null };
}
