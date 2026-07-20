import { isContentStatus } from "./contentTransitions";

const changedFields = new Set([
  "payload",
  "status",
  "deleted_at",
  "title",
  "chapter",
  "tags",
  "source",
  "review_status",
  "case_type",
]);

function safeNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function safeAuditMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  if (isContentStatus(record.previousStatus)) output.previousStatus = record.previousStatus;
  if (isContentStatus(record.nextStatus)) output.nextStatus = record.nextStatus;

  const version = safeNonNegativeInteger(record.version);
  if (version !== undefined) output.version = version;

  const itemCount = safeNonNegativeInteger(record.itemCount);
  if (itemCount !== undefined) output.itemCount = itemCount;

  if (Array.isArray(record.changedFields)) {
    const fields = record.changedFields.filter((field): field is string => typeof field === "string" && changedFields.has(field));
    if (fields.length) output.changedFields = [...new Set(fields)];
  }

  if (record.conflictResolution === "keep_local" || record.conflictResolution === "keep_cloud" || record.conflictResolution === "keep_both" || record.conflictResolution === "decide_later") {
    output.conflictResolution = record.conflictResolution;
  }

  if (record.systemOperation === "canonical_seed") output.systemOperation = "canonical_seed";

  return output;
}
