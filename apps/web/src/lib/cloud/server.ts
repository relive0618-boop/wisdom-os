import "server-only";

import { AnalyzeResponseSchema, CloudMutationSchema, PdcaCycleSchema } from "@wisdom/shared";
import { NextResponse } from "next/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { claimsUserId, getVerifiedClaims } from "@/lib/supabase/server";
import type { CloudErrorCode } from "@/lib/supabase/types";

export function cloudError(code: CloudErrorCode, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}

export async function cloudContext() {
  const config = supabaseConfig();
  if (!config.configured || !config.flags.syncEnabled) return { error: cloudError("CLOUD_NOT_CONFIGURED", 503) } as const;
  const { client, claims } = await getVerifiedClaims();
  const userId = claimsUserId(claims);
  if (!client || !userId) return { error: cloudError("AUTH_REQUIRED", 401) } as const;
  return { client, userId } as const;
}

export async function readJson(request: Request) {
  try { return { value: await request.json() }; } catch { return { error: cloudError("CLOUD_INVALID_INPUT", 422) }; }
}

type Entity = "reports" | "pdca";
const tableFor = (entity: Entity) => entity === "reports" ? "user_reports" : "user_pdca_cycles";
const keyFor = (entity: Entity) => entity === "reports" ? "report_id" : "cycle_id";

export async function listCloudEntity(entity: Entity) {
  const context = await cloudContext(); if ("error" in context) return context.error;
  const { data, error } = await context.client.from(tableFor(entity)).select("*").is("deleted_at", null).order("updated_at", { ascending: false });
  if (error) return cloudError("CLOUD_TEMPORARILY_UNAVAILABLE", 503);
  return NextResponse.json({ data: data ?? [] });
}

export async function saveCloudEntity(request: Request, entity: Entity, id?: string) {
  const context = await cloudContext(); if ("error" in context) return context.error;
  const body = await readJson(request); if ("error" in body) return body.error;
  const parsed = CloudMutationSchema.safeParse(body.value); if (!parsed.success) return cloudError("CLOUD_INVALID_INPUT", 422);
  const payload = entity === "reports" ? AnalyzeResponseSchema.safeParse(parsed.data.payload) : PdcaCycleSchema.safeParse(parsed.data.payload);
  if (!payload.success) return cloudError("CLOUD_INVALID_INPUT", 422);
  const entityId = id ?? (entity === "reports" ? payload.data.reportId : payload.data.cycleId);
  const key = keyFor(entity);
  const table = tableFor(entity);
  const { data: existing, error: lookupError } = await context.client.from(table).select("revision").eq(key, entityId).maybeSingle();
  if (lookupError) return cloudError("CLOUD_TEMPORARILY_UNAVAILABLE", 503);
  if (parsed.data.expectedRevision && existing?.revision !== parsed.data.expectedRevision) {
    return NextResponse.json({ error: { code: "CLOUD_CONFLICT" }, cloudRevision: existing?.revision ?? null }, { status: 409 });
  }
  let data: unknown, error: unknown;
  if (entity === "reports") {
    const report = payload.data as ReturnType<typeof AnalyzeResponseSchema.parse>;
    ({ data, error } = await context.client.from("user_reports").upsert({ user_id: context.userId, report_id: entityId, decision_id: report.decisionId, title: report.report.problem_summary.slice(0, 80), category: report.report.category, payload: report, analysis_meta: { provider: report.provider, analysisMode: report.analysisMode }, device_id: parsed.data.deviceId ?? null, client_updated_at: parsed.data.clientUpdatedAt ?? null, deleted_at: null }, { onConflict: "user_id,report_id" }).select("*").single());
  } else {
    const cycle = payload.data as ReturnType<typeof PdcaCycleSchema.parse>;
    ({ data, error } = await context.client.from("user_pdca_cycles").upsert({ user_id: context.userId, cycle_id: entityId, report_id: cycle.reportId, payload: cycle, device_id: parsed.data.deviceId ?? null, client_updated_at: parsed.data.clientUpdatedAt ?? null, deleted_at: null }, { onConflict: "user_id,cycle_id" }).select("*").single());
  }
  if (error) return cloudError("CLOUD_TEMPORARILY_UNAVAILABLE", 503);
  return NextResponse.json({ data }, { status: existing ? 200 : 201 });
}

export async function deleteCloudEntity(entity: Entity, id: string, expectedRevision: number | null) {
  const context = await cloudContext(); if ("error" in context) return context.error;
  const table = tableFor(entity), key = keyFor(entity);
  const { data: existing, error: lookupError } = await context.client.from(table).select("revision").eq(key, id).maybeSingle();
  if (lookupError) return cloudError("CLOUD_TEMPORARILY_UNAVAILABLE", 503);
  if (!existing) return cloudError("CLOUD_NOT_FOUND", 404);
  if (expectedRevision && existing.revision !== expectedRevision) return cloudError("CLOUD_CONFLICT", 409);
  const { error } = await context.client.from(table).update({ deleted_at: new Date().toISOString() }).eq(key, id);
  if (error) return cloudError("CLOUD_TEMPORARILY_UNAVAILABLE", 503);
  return new NextResponse(null, { status: 204 });
}
