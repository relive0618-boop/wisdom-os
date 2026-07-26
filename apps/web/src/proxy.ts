import { NextResponse, type NextRequest } from "next/server";
import { updateAuthSession } from "@/lib/supabase/proxy";
import { supabaseConfig } from "@/lib/supabase/config";

const protectedPrefixes = ["/account", "/sync", "/api/cloud/"];
const adminPrefixes = ["/admin", "/api/admin/"];

function safeNext(pathname: string) { return pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : "/"; }

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Playwright's local test server has no real Supabase session. This bypass
  // is deliberately impossible for a deployed hostname and is only enabled
  // by the E2E web-server process.
  const e2eSyncBypass = process.env.WISDOM_E2E_BYPASS_AUTH === "true"
    && request.nextUrl.hostname === "localhost"
    && request.headers.get("x-wisdom-e2e-sync") === "1"
    && pathname === "/sync";
  const { response, claims } = await updateAuthSession(request);
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  const metadata = claims?.app_metadata;
  const isAdmin = Boolean(metadata && typeof metadata === "object" && (metadata as Record<string, unknown>).role === "admin");
  if (adminPrefixes.some((prefix) => pathname.startsWith(prefix)) && !isAdmin) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: { code: userId ? "CLOUD_FORBIDDEN" : "AUTH_REQUIRED" } }, { status: userId ? 403 : 401 });
    const url = request.nextUrl.clone(); url.pathname = "/login"; url.searchParams.set("next", safeNext(pathname)); return NextResponse.redirect(url);
  }
  const cloudApiUnavailable = pathname.startsWith("/api/cloud/") && !supabaseConfig().configured;
  if (protectedPrefixes.some((prefix) => pathname.startsWith(prefix)) && !userId && !cloudApiUnavailable && !e2eSyncBypass) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 });
    const url = request.nextUrl.clone(); url.pathname = "/login"; url.searchParams.set("next", safeNext(pathname)); return NextResponse.redirect(url);
  }
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
