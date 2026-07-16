import { NextResponse } from "next/server";
import { getRouteSupabaseClient } from "@/lib/supabase/route";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /%2f%2f|%3a/i.test(value)) return "/reset-password";
  try {
    const parsed = new URL(value, "https://wisdom.local");
    return parsed.origin === "https://wisdom.local" ? `${parsed.pathname}${parsed.search}` : "/reset-password";
  } catch {
    return "/reset-password";
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL(safeNextPath(url.searchParams.get("next")), url.origin));
  const client = await getRouteSupabaseClient(response);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (client && code) await client.auth.exchangeCodeForSession(code);
  else if (client && tokenHash && type === "recovery") await client.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });

  return response;
}
