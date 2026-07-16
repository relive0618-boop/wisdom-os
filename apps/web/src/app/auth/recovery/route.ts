import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const client = await getServerSupabaseClient();

  if (client && code) await client.auth.exchangeCodeForSession(code);
  else if (client && tokenHash && type === "recovery") await client.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });

  return NextResponse.redirect(new URL("/reset-password", url.origin));
}
