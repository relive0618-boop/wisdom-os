import { NextResponse } from "next/server";
import { adminContext } from "@/lib/admin/server";
import { parseAuditQuery } from "@/lib/admin/auditQuery";
import { safeAuditMetadata } from "@/lib/admin/safeAuditMetadata";

export async function GET(request: Request) {
  const context = await adminContext();
  if ("error" in context) return context.error;
  const parsed = parseAuditQuery(new URL(request.url).searchParams);
  if (!parsed) return NextResponse.json({ error: { code: "CLOUD_INVALID_INPUT" } }, { status: 422 });

  let requestQuery = context.client.from("admin_audit_logs")
    .select("actor_id,action,entity_type,entity_id,metadata,created_at")
    .order("created_at", { ascending: false })
    .range(parsed.offset, parsed.offset + parsed.limit - 1);
  if (parsed.action) requestQuery = requestQuery.eq("action", parsed.action);
  if (parsed.entityType) requestQuery = requestQuery.eq("entity_type", parsed.entityType);

  const { data, error } = await requestQuery;
  if (error) return NextResponse.json({ error: { code: "CLOUD_TEMPORARILY_UNAVAILABLE" } }, { status: 503 });
  return NextResponse.json({
    data: (data ?? []).map((item) => ({
      actor: item.actor_id ? "authenticated-admin" : "system",
      action: item.action,
      entityType: item.entity_type,
      entityId: item.entity_id,
      createdAt: item.created_at,
      metadata: safeAuditMetadata(item.metadata),
    })),
  });
}
