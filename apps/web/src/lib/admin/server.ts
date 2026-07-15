import "server-only";
import { CaseSchema, KnowledgeItemSchema } from "@wisdom/shared";
import { NextResponse } from "next/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { claimsAreAdmin, claimsUserId, getVerifiedClaims } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

export const contentTable = (kind: string) => kind === "knowledge" ? "knowledge_entries" : kind === "cases" ? "case_entries" : null;
const statuses = ["draft", "reviewed", "published", "archived"] as const;
function validTransition(from: string, to: string) { return from === to || (from === "draft" && to === "reviewed") || (from === "reviewed" && (to === "draft" || to === "published")) || (from === "published" && to === "archived") || (from === "archived" && to === "draft"); }
export async function adminContext() { const config = supabaseConfig(); if (!config.configured || !config.flags.adminEnabled) return { error: NextResponse.json({ error: { code: "CLOUD_NOT_CONFIGURED" } }, { status: 503 }) } as const; const { client, claims } = await getVerifiedClaims(); if (!client || !claimsUserId(claims)) return { error: NextResponse.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 }) } as const; if (!claimsAreAdmin(claims)) return { error: NextResponse.json({ error: { code: "CLOUD_FORBIDDEN" } }, { status: 403 }) } as const; return { client, userId: claimsUserId(claims)! } as const; }
export function parseContent(kind: string, value: unknown) { return kind === "knowledge" ? KnowledgeItemSchema.safeParse(value) : kind === "cases" ? CaseSchema.safeParse(value) : { success: false } as const; }
export async function audit(_client: NonNullable<Awaited<ReturnType<typeof adminContext>>["client"]>, actorId: string, action: string, type: string, id: string) { const client = getAdminSupabaseClient(); if (!client) return; await client.from("admin_audit_logs").insert({ actor_id: actorId, action, entity_type: type, entity_id: id, metadata: { action } }); }
export { statuses, validTransition };
