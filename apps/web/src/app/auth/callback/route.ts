import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/supabase/server";
function safeNextPath(value: string | null) { if (!value || !value.startsWith("/") || value.startsWith("//") || /%2f%2f|%3a/i.test(value)) return "/account"; try { const parsed = new URL(value, "https://wisdom.local"); return parsed.origin === "https://wisdom.local" ? `${parsed.pathname}${parsed.search}` : "/account"; } catch { return "/account"; } }
export async function GET(request: Request) { const url = new URL(request.url); const code = url.searchParams.get("code"); const client = await getServerSupabaseClient(); if (code && client) await client.auth.exchangeCodeForSession(code); return NextResponse.redirect(new URL(safeNextPath(url.searchParams.get("next")), url.origin)); }
