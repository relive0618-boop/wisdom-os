import { SyncPushRequestSchema } from "@wisdom/shared";
import { cloudContext, cloudError, saveCloudEntity } from "@/lib/cloud/server";
import { NextResponse } from "next/server";
export async function POST(request: Request) {
  const body = await request.json().catch(() => null); const parsed = SyncPushRequestSchema.safeParse(body);
  if (!parsed.success) return cloudError("CLOUD_INVALID_INPUT", 422);
  const context = await cloudContext(); if ("error" in context) return context.error;
  const results: Array<{ entityType: string; entityId: string; success: boolean; operation: string; cloudRevision: null; errorCode: string | null }> = [];
  for (const entity of parsed.data.entities) {
    const nested = new Request(request.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: entity.payload, expectedRevision: entity.revision, deviceId: parsed.data.deviceId, clientUpdatedAt: entity.updatedAt }) });
    const result = await saveCloudEntity(nested, entity.entityType === "report" ? "reports" : "pdca", entity.entityId);
    const success = (result?.status ?? 500) < 300;
    results.push({ entityType: entity.entityType, entityId: entity.entityId, success, operation: "upload_update", cloudRevision: null, errorCode: success ? null : "CLOUD_TEMPORARILY_UNAVAILABLE" });
  }
  return NextResponse.json({ results });
}
