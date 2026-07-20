export type ClaimsLike = { sub?: unknown; app_metadata?: unknown } | null;
export function claimsUserId(claims: ClaimsLike) { return typeof claims?.sub === "string" ? claims.sub : null; }
export function claimsAreAdmin(claims: ClaimsLike) { const metadata = claims?.app_metadata; return Boolean(metadata && typeof metadata === "object" && (metadata as Record<string, unknown>).role === "admin"); }
