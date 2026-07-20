import "server-only";
import { CaseSchema, KnowledgeItemSchema } from "@wisdom/shared";
import { NextResponse } from "next/server";
import { contentStatuses, type ContentStatus } from "./contentTransitions";
import { supabaseConfig } from "@/lib/supabase/config";
import { claimsAreAdmin, claimsUserId, getVerifiedClaims } from "@/lib/supabase/server";

export const contentTable = (kind: string) => kind === "knowledge" ? "knowledge_entries" : kind === "cases" ? "case_entries" : null;

export const statuses = contentStatuses;
export type AdminContentStatus = ContentStatus;

export async function adminContext() {
  const config = supabaseConfig();
  if (!config.configured || !config.flags.adminEnabled) {
    return { error: NextResponse.json({ error: { code: "CLOUD_NOT_CONFIGURED" } }, { status: 503 }) } as const;
  }
  const { client, claims } = await getVerifiedClaims();
  const userId = claimsUserId(claims);
  if (!client || !userId) {
    return { error: NextResponse.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 }) } as const;
  }
  if (!claimsAreAdmin(claims)) {
    return { error: NextResponse.json({ error: { code: "CLOUD_FORBIDDEN" } }, { status: 403 }) } as const;
  }
  return { client, userId } as const;
}

export function parseContent(kind: string, value: unknown) {
  return kind === "knowledge"
    ? KnowledgeItemSchema.safeParse(value)
    : kind === "cases"
      ? CaseSchema.safeParse(value)
      : { success: false } as const;
}

export function cloudDatabaseError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
  return code === "P0001"
    ? NextResponse.json({ error: { code: "CLOUD_CONFLICT" } }, { status: 409 })
    : NextResponse.json({ error: { code: "CLOUD_TEMPORARILY_UNAVAILABLE" } }, { status: 503 });
}
