import { CloudErrorCodeSchema, SyncPushRequestSchema } from "@wisdom/shared";
import { cloudContext, cloudError, saveCloudEntity } from "@/lib/cloud/server";
import { NextResponse } from "next/server";
export async function POST(request: Request) {
  const body = await request.json().catch(() => null); const parsed = SyncPushRequestSchema.safeParse(body);
  if (!parsed.success) return cloudError("CLOUD_INVALID_INPUT", 422);
  const context = await cloudContext(); if ("error" in context) return context.error;
  const results: Array<{ entityType: "report" | "pdca"; entityId: string; success: boolean; operation: "upload_create" | "upload_update"; cloudRevision: number | null; errorCode: string | null }> = [];
  for (const entity of parsed.data.entities) {
    const nested = new Request(request.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: entity.payload, expectedRevision: entity.revision, deviceId: parsed.data.deviceId, clientUpdatedAt: entity.updatedAt }) });
    const result = await saveCloudEntity(nested, entity.entityType === "report" ? "reports" : "pdca", entity.entityId);
    if (!result) {
      results.push({ entityType: entity.entityType, entityId: entity.entityId, success: false, operation: entity.revision ? "upload_update" : "upload_create", cloudRevision: null, errorCode: "CLOUD_TEMPORARILY_UNAVAILABLE" });
      continue;
    }
    const body = await result.json().catch(() => null) as { data?: { revision?: unknown }; error?: { code?: unknown }; cloudRevision?: unknown } | null;
    const success = result.ok;
    const revision = typeof body?.data?.revision === "number" && Number.isInteger(body.data.revision) && body.data.revision > 0 ? body.data.revision : typeof body?.cloudRevision === "number" && Number.isInteger(body.cloudRevision) && body.cloudRevision > 0 ? body.cloudRevision : null;
    const code = CloudErrorCodeSchema.safeParse(body?.error?.code);
    results.push({ entityType: entity.entityType, entityId: entity.entityId, success, operation: entity.revision ? "upload_update" : "upload_create", cloudRevision: revision, errorCode: success ? null : code.success ? code.data : "CLOUD_TEMPORARILY_UNAVAILABLE" });
  }
  return NextResponse.json({ results });
}
