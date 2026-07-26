import { cloudContext } from "@/lib/cloud/server";
import { normalizeCloudTimestamp } from "@/lib/cloud/timestamp";
import { CloudPdcaCycleSchema, CloudReportSchema } from "@wisdom/shared";
import { NextResponse } from "next/server";

function mapReport(value: Record<string, unknown>) {
  return CloudReportSchema.safeParse({
    reportId: value.report_id,
    decisionId: value.decision_id,
    title: value.title,
    category: value.category,
    payload: value.payload,
    revision: value.revision,
    deviceId: value.device_id ?? null,
    clientUpdatedAt: value.client_updated_at === null ? null : normalizeCloudTimestamp(value.client_updated_at),
    updatedAt: normalizeCloudTimestamp(value.updated_at),
    deletedAt: value.deleted_at === null ? null : normalizeCloudTimestamp(value.deleted_at),
  });
}

function mapCycle(value: Record<string, unknown>) {
  return CloudPdcaCycleSchema.safeParse({
    cycleId: value.cycle_id,
    reportId: value.report_id,
    payload: value.payload,
    revision: value.revision,
    deviceId: value.device_id ?? null,
    clientUpdatedAt: value.client_updated_at === null ? null : normalizeCloudTimestamp(value.client_updated_at),
    updatedAt: normalizeCloudTimestamp(value.updated_at),
    deletedAt: value.deleted_at === null ? null : normalizeCloudTimestamp(value.deleted_at),
  });
}

export async function POST() {
  const context = await cloudContext();
  if ("error" in context) return context.error;
  const [reports, cycles] = await Promise.all([
    context.client.from("user_reports").select("*").is("deleted_at", null).order("updated_at", { ascending: false }),
    context.client.from("user_pdca_cycles").select("*").is("deleted_at", null).order("updated_at", { ascending: false }),
  ]);
  if (reports.error || cycles.error) return NextResponse.json({ error: { code: "CLOUD_TEMPORARILY_UNAVAILABLE" } }, { status: 503 });
  const safeReports = (reports.data ?? []).flatMap((item) => {
    const parsed = mapReport(item as Record<string, unknown>);
    return parsed.success ? [parsed.data] : [];
  });
  const safeCycles = (cycles.data ?? []).flatMap((item) => {
    const parsed = mapCycle(item as Record<string, unknown>);
    return parsed.success ? [parsed.data] : [];
  });
  return NextResponse.json({
    reports: safeReports,
    cycles: safeCycles,
    invalid: {
      reports: (reports.data ?? []).length - safeReports.length,
      cycles: (cycles.data ?? []).length - safeCycles.length,
    },
  });
}
