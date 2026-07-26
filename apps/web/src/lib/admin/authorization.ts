import { claimsAreAdmin, claimsUserId, type ClaimsLike } from "@/lib/supabase/claims";
export function adminAuthorization(claims: ClaimsLike) { return { authenticated: Boolean(claimsUserId(claims)), admin: claimsAreAdmin(claims) }; }
