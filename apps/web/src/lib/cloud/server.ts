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
export type CloudMutationOperation = "create" | "update" | "delete";
const tableFor = (entity: Entity) => entity === "reports" ? "user_reports" : "user_pdca_cycles";
const keyFor = (entity: Entity) => entity === "reports" ? "report_id" : "cycle_id";

type MutationInput = {
  payload?: unknown;
  expectedRevision: number | null;
  deviceId: string | null;
  clientUpdatedAt: string | null;
};

type RpcResult = { result?: unknown; cloud_revision?: unknown; updated_at?: unknown; deleted_at?: unknown };

function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parseMutation(value: unknown, operation: CloudMutationOperation): MutationInput | null {
  if (operation === "delete") {
    if (!value || typeof value !== "object") return null;
    const raw = value as { expectedRevision?: unknown; deviceId?: unknown; clientUpdatedAt?: unknown };
    if (!validRevision(raw.expectedRevision)) return null;
    return {
      expectedRevision: raw.expectedRevision,
      deviceId: typeof raw.deviceId === "string" && raw.deviceId.length <= 200 ? raw.deviceId : null,
      clientUpdatedAt: typeof raw.clientUpdatedAt === "string" ? raw.clientUpdatedAt : null,
    };
  }
  const parsed = CloudMutationSchema.safeParse(value);
  if (!parsed.success) return null;
  if (operation === "create" && parsed.data.expectedRevision !== null && parsed.data.expectedRevision !== undefined) return null;
  if (operation === "update" && !validRevision(parsed.data.expectedRevision)) return null;
  return {
    payload: parsed.data.payload,
    expectedRevision: parsed.data.expectedRevision ?? null,
    deviceId: parsed.data.deviceId ?? null,
    clientUpdatedAt: parsed.data.clientUpdatedAt ?? null,
  };
}

export async function listCloudEntity(entity: Entity) {
  const context = await cloudContext(); if ("error" in context) return context.error;
  const { data, error } = await context.client.from(tableFor(entity)).select("*").is("deleted_at", null).order("updated_at", { ascending: false });
  if (error) return cloudError("CLOUD_TEMPORARILY_UNAVAILABLE", 503);
  return NextResponse.json({ data: data ?? [] });
}

export async function mutateCloudEntity(
  entity: Entity,
  id: string,
  operation: CloudMutationOperation,
  input: MutationInput,
) {
  const context = await cloudContext(); if ("error" in context) return context.error;
  let payload: ReturnType<typeof AnalyzeResponseSchema.parse> | ReturnType<typeof PdcaCycleSchema.parse> | null = null;
  if (operation !== "delete") {
    const parsed = entity === "reports" ? AnalyzeResponseSchema.safeParse(input.payload) : PdcaCycleSchema.safeParse(input.payload);
    if (!parsed.success) return cloudError("CLOUD_INVALID_INPUT", 422);
    payload = parsed.data;
    const payloadId = entity === "reports" ? payload.reportId : payload.cycleId;
    if (payloadId !== id) return cloudError("CLOUD_INVALID_INPUT", 422);
  }

  const rpc = entity === "reports" ? "sync_mutate_report" : "sync_mutate_pdca_cycle";
  const args = entity === "reports"
    ? {
        operation_input: operation,
        report_id_input: id,
        expected_revision_input: input.expectedRevision,
        payload_input: payload,
        device_id_input: input.deviceId,
        client_updated_at_input: input.clientUpdatedAt,
      }
    : {
        operation_input: operation,
        cycle_id_input: id,
        expected_revision_input: input.expectedRevision,
        payload_input: payload,
        device_id_input: input.deviceId,
        client_updated_at_input: input.clientUpdatedAt,
      };
  const { data, error } = await context.client.rpc(rpc, args);
  if (error) return cloudError("CLOUD_TEMPORARILY_UNAVAILABLE", 503);
  const result = Array.isArray(data) ? data[0] as RpcResult | undefined : undefined;
  const status = result?.result;
  const cloudRevision = validRevision(result?.cloud_revision) ? result.cloud_revision : null;
  if (status === "conflict") return NextResponse.json({ error: { code: "CLOUD_CONFLICT" }, cloudRevision }, { status: 409 });
  if (status === "not_found") return cloudError("CLOUD_NOT_FOUND", 404);
  if (status !== "created" && status !== "updated" && status !== "deleted") return cloudError("CLOUD_TEMPORARILY_UNAVAILABLE", 503);
  return NextResponse.json({ data: { revision: cloudRevision } }, { status: status === "created" ? 201 : operation === "delete" ? 204 : 200 });
}

export async function saveCloudEntity(request: Request, entity: Entity, id?: string) {
  const body = await readJson(request); if ("error" in body) return body.error;
  const operation: CloudMutationOperation = id ? "update" : "create";
  const input = parseMutation(body.value, operation);
  if (!input || input.payload === undefined) return cloudError("CLOUD_INVALID_INPUT", 422);
  const parsed = entity === "reports" ? AnalyzeResponseSchema.safeParse(input.payload) : PdcaCycleSchema.safeParse(input.payload);
  if (!parsed.success) return cloudError("CLOUD_INVALID_INPUT", 422);
  const payloadId = entity === "reports" ? parsed.data.reportId : parsed.data.cycleId;
  if (id && payloadId !== id) return cloudError("CLOUD_INVALID_INPUT", 422);
  return mutateCloudEntity(entity, id ?? payloadId, operation, input);
}

export async function deleteCloudEntity(entity: Entity, id: string, value: unknown) {
  const input = parseMutation(value, "delete");
  if (!input) return cloudError("CLOUD_INVALID_INPUT", 422);
  return mutateCloudEntity(entity, id, "delete", input);
}

export function entityTableName(entity: Entity) { return tableFor(entity); }
export function entityKeyName(entity: Entity) { return keyFor(entity); }
