import { CloudErrorCodeSchema, SyncPushRequestSchema } from "@wisdom/shared";
import { cloudError, mutateCloudEntity } from "@/lib/cloud/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = SyncPushRequestSchema.safeParse(body);
  if (!parsed.success) return cloudError("CLOUD_INVALID_INPUT", 422);

  const results: Array<{
    entityType: "report" | "pdca";
    entityId: string;
    success: boolean;
    operation: "upload_create" | "upload_update";
    cloudRevision: number | null;
    errorCode: string | null;
  }> = [];

  for (const entity of parsed.data.entities) {
    const operation = entity.revision === null || entity.revision === undefined ? "create" : "update";
    const response = await mutateCloudEntity(
      entity.entityType === "report" ? "reports" : "pdca",
      entity.entityId,
      operation,
      {
        payload: entity.payload,
        expectedRevision: entity.revision ?? null,
        deviceId: parsed.data.deviceId,
        clientUpdatedAt: entity.updatedAt ?? null,
      },
    );
    if (!response) {
      results.push({ entityType: entity.entityType, entityId: entity.entityId, success: false, operation: operation === "create" ? "upload_create" : "upload_update", cloudRevision: null, errorCode: "CLOUD_TEMPORARILY_UNAVAILABLE" });
      continue;
    }
    const responseBody = await response.json().catch(() => null) as { data?: { revision?: unknown }; error?: { code?: unknown }; cloudRevision?: unknown } | null;
    const cloudRevision = typeof responseBody?.data?.revision === "number"
      ? responseBody.data.revision
      : typeof responseBody?.cloudRevision === "number" ? responseBody.cloudRevision : null;
    const code = CloudErrorCodeSchema.safeParse(responseBody?.error?.code);
    results.push({
      entityType: entity.entityType,
      entityId: entity.entityId,
      success: response.ok,
      operation: operation === "create" ? "upload_create" : "upload_update",
      cloudRevision,
      errorCode: response.ok ? null : code.success ? code.data : "CLOUD_TEMPORARILY_UNAVAILABLE",
    });
  }
  return NextResponse.json({ results });
}
