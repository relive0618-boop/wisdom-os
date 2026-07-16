import { NextResponse } from "next/server";
import { getRouteSupabaseClient } from "@/lib/supabase/route";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const response = NextResponse.redirect(new URL("/reset-password", url.origin));
  const client = await getRouteSupabaseClient(response);
  let established = false;

  if (client && code) established = !(await client.auth.exchangeCodeForSession(code)).error;
  if (!established && client && tokenHash && type === "recovery") await client.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });

  return response;
}
