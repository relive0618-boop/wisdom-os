"use client";

import {
  CloudPdcaCycleSchema,
  CloudReportSchema,
  SyncMetadataSchema,
  type CloudPdcaCycle,
  type CloudReport,
  type SyncEntity,
  type SyncMetadata,
} from "@wisdom/shared";

export type SyncState = "idle" | "syncing" | "synced" | "offline" | "conflict" | "error";
export const SYNC_BATCH_SIZE = 25;
const METADATA_KEY = "wisdom_cloud_sync_metadata_v1";
const WIZARD_KEY = "wisdom_cloud_migration_v1";
const DEVICE_KEY = "wisdom_cloud_device_id_v1";

export type SyncPushResult = {
  entityType: SyncEntity["entityType"];
  entityId: string;
  success: boolean;
  operation: "upload_create" | "upload_update";
  cloudRevision: number | null;
  errorCode: string | null;
  hash: string;
  updatedAt: string | null;
};

export type PlannedSyncOperation = "upload_create" | "upload_update" | "download_create" | "download_update" | "conflict" | "noop";
export type PlannedSyncItem = {
  entityType: SyncEntity["entityType"];
  entityId: string;
  operation: PlannedSyncOperation;
  local: { payload: unknown; updatedAt: string } | null;
  cloud: CloudReport | CloudPdcaCycle | null;
  localHash: string | null;
  cloudHash: string | null;
  expectedRevision: number | null;
  reason: string;
};

export type CloudSnapshot = {
  reports: CloudReport[];
  cycles: CloudPdcaCycle[];
  invalidReports: number;
  invalidCycles: number;
};

export type CloudRestorePlan = {
  reports: CloudReport[];
  cycles: CloudPdcaCycle[];
  existingReports: string[];
  existingCycles: string[];
  invalid: number;
};

export function parseCloudSnapshot(value: unknown): CloudSnapshot {
  if (!value || typeof value !== "object") return { reports: [], cycles: [], invalidReports: 0, invalidCycles: 0 };
  const body = value as { reports?: unknown; cycles?: unknown; invalid?: { reports?: unknown; cycles?: unknown } };
  const rawReports = Array.isArray(body.reports) ? body.reports : [];
  const rawCycles = Array.isArray(body.cycles) ? body.cycles : [];
  const reports = rawReports.flatMap((item) => {
    const parsed = CloudReportSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const cycles = rawCycles.flatMap((item) => {
    const parsed = CloudPdcaCycleSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const reportedInvalidReports = typeof body.invalid?.reports === "number" && Number.isInteger(body.invalid.reports) && body.invalid.reports >= 0 ? body.invalid.reports : 0;
  const reportedInvalidCycles = typeof body.invalid?.cycles === "number" && Number.isInteger(body.invalid.cycles) && body.invalid.cycles >= 0 ? body.invalid.cycles : 0;
  return {
    reports,
    cycles,
    invalidReports: rawReports.length - reports.length + reportedInvalidReports,
    invalidCycles: rawCycles.length - cycles.length + reportedInvalidCycles,
  };
}

export function planCloudRestore(snapshot: CloudSnapshot, localReportIds: Iterable<string>, localCycleIds: Iterable<string>): CloudRestorePlan {
  const reports = new Set(localReportIds);
  const cycles = new Set(localCycleIds);
  const missingReports = snapshot.reports.filter((item) => !reports.has(item.reportId));
  const missingCycles = snapshot.cycles.filter((item) => !cycles.has(item.cycleId));
  return {
    reports: missingReports,
    cycles: missingCycles,
    existingReports: snapshot.reports.filter((item) => reports.has(item.reportId)).map((item) => item.reportId),
    existingCycles: snapshot.cycles.filter((item) => cycles.has(item.cycleId)).map((item) => item.cycleId),
    invalid: snapshot.invalidReports + snapshot.invalidCycles,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

export function canonicalSyncPayload(entityType: SyncEntity["entityType"], value: unknown): unknown {
  const parsed = entityType === "report" ? CloudReportSchema.shape.payload.safeParse(value) : CloudPdcaCycleSchema.shape.payload.safeParse(value);
  return canonicalize(parsed.success ? parsed.data : value);
}

export async function syncPayloadHash(entityType: SyncEntity["entityType"], value: unknown) {
  return stableHash(canonicalSyncPayload(entityType, value));
}

export async function planCloudSync(
  local: Array<{ entityType: SyncEntity["entityType"]; entityId: string; payload: unknown; updatedAt: string }>,
  snapshot: CloudSnapshot,
  metadata: SyncMetadata[],
): Promise<PlannedSyncItem[]> {
  const cloud = [
    ...snapshot.reports.map((item) => ({ entityType: "report" as const, entityId: item.reportId, value: item })),
    ...snapshot.cycles.map((item) => ({ entityType: "pdca" as const, entityId: item.cycleId, value: item })),
  ];
  const ids = new Set([...local, ...cloud].map((item) => metadataEntityId(item.entityType, item.entityId)));
  const metadataByEntity = new Map(metadata.map((item) => [item.entityId, item]));
  const plans: PlannedSyncItem[] = [];
  for (const id of ids) {
    const localItem = local.find((item) => metadataEntityId(item.entityType, item.entityId) === id) ?? null;
    const cloudItem = cloud.find((item) => metadataEntityId(item.entityType, item.entityId) === id) ?? null;
    const base = localItem ?? cloudItem!;
    const entityType = base.entityType;
    const entityId = base.entityId;
    const saved = metadataByEntity.get(id) ?? null;
    const localHash = localItem ? await syncPayloadHash(entityType, localItem.payload) : null;
    const cloudHash = cloudItem ? await syncPayloadHash(entityType, cloudItem.value.payload) : null;
    const plannedBase = { entityType, entityId, local: localItem, cloud: cloudItem?.value ?? null, localHash, cloudHash, expectedRevision: cloudItem?.value.revision ?? saved?.cloudRevision ?? null };

    if (!cloudItem && localItem) {
      plans.push({ ...plannedBase, operation: saved?.cloudRevision || saved?.lastSyncedHash ? "conflict" : "upload_create", reason: saved?.cloudRevision || saved?.lastSyncedHash ? "cloud_missing_with_metadata" : "missing_cloud" });
      continue;
    }
    if (cloudItem && !localItem) {
      plans.push({ ...plannedBase, operation: "download_create", reason: "missing_local" });
      continue;
    }
    if (!localItem || !cloudItem) continue;
    if (localHash === cloudHash) {
      plans.push({ ...plannedBase, operation: "noop", reason: "hash_match" });
      continue;
    }
    if (!saved?.lastSyncedHash) {
      plans.push({ ...plannedBase, operation: "conflict", reason: "same_id_without_trusted_metadata" });
      continue;
    }
    if (localHash === saved.lastSyncedHash && cloudHash !== saved.lastSyncedHash) {
      plans.push({ ...plannedBase, operation: "download_update", reason: "cloud_changed_since_sync" });
      continue;
    }
    if (cloudHash === saved.lastSyncedHash && localHash !== saved.lastSyncedHash) {
      plans.push({ ...plannedBase, operation: "upload_update", reason: "local_changed_since_sync" });
      continue;
    }
    plans.push({ ...plannedBase, operation: "conflict", reason: "both_changed_since_sync" });
  }
  return plans;
}

export interface SyncRepository {
  listMetadata(): SyncMetadata[];
  getMetadata(entityId: string): SyncMetadata | null;
  saveMetadata(metadata: SyncMetadata): void;
  listBatches<T>(items: T[]): T[][];
}

function readMetadata() {
  if (typeof window === "undefined") return [] as SyncMetadata[];
  try {
    const value = JSON.parse(localStorage.getItem(METADATA_KEY) || "[]");
    return Array.isArray(value) ? value.flatMap((item) => { const parsed = SyncMetadataSchema.safeParse(item); return parsed.success ? [parsed.data] : []; }) : [];
  } catch { return []; }
}
export const syncRepository: SyncRepository = {
  listMetadata: readMetadata,
  getMetadata: (entityId) => readMetadata().find((item) => item.entityId === entityId) ?? null,
  saveMetadata: (metadata) => { const parsed = SyncMetadataSchema.safeParse(metadata); if (!parsed.success) throw new Error("SYNC_METADATA_INVALID"); const values = readMetadata().filter((item) => item.entityId !== metadata.entityId); localStorage.setItem(METADATA_KEY, JSON.stringify([...values, parsed.data])); },
  listBatches: <T,>(items: T[]) => Array.from({ length: Math.ceil(items.length / SYNC_BATCH_SIZE) }, (_, index) => items.slice(index * SYNC_BATCH_SIZE, (index + 1) * SYNC_BATCH_SIZE)),
};

export type MigrationStep = "scan" | "preview" | "choose" | "execute" | "complete";
export type MigrationState = { step: MigrationStep; selectedIds: string[]; processed: number; total: number; cancelled: boolean; errors: string[]; updatedAt: string };
export function loadMigrationState(): MigrationState | null { if (typeof window === "undefined") return null; try { const value = JSON.parse(localStorage.getItem(WIZARD_KEY) || "null"); return value && typeof value.step === "string" ? value : null; } catch { return null; } }
export function saveMigrationState(value: MigrationState) { localStorage.setItem(WIZARD_KEY, JSON.stringify(value)); }
export function createMigrationState(total: number): MigrationState { return { step: "scan", selectedIds: [], processed: 0, total, cancelled: false, errors: [], updatedAt: new Date().toISOString() }; }

export function conflictDuplicateId(entityId: string) { return `${entityId}-copy-${crypto.randomUUID().slice(0, 8)}`; }
export function metadataEntityId(entityType: SyncEntity["entityType"], entityId: string) { return `${entityType}:${entityId}`; }
export function conflictResolutionMetadata(metadata: SyncMetadata, strategy: "local" | "cloud" | "both", cloudRevision: number | null): SyncMetadata {
  return { ...metadata, cloudRevision, lastSyncedAt: new Date().toISOString(), syncState: strategy === "both" ? "pending_upload" : "synced", source: strategy === "local" ? "local" : strategy === "cloud" ? "cloud" : "both", pendingOperation: strategy === "local" ? "update" : "none", localBackupAt: strategy === "cloud" ? new Date().toISOString() : metadata.localBackupAt ?? null };
}

export async function stableHash(value: unknown) {
  const data = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getOrCreateDeviceId() {
  if (typeof window === "undefined") return crypto.randomUUID();
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && existing.length <= 200) return existing;
    const next = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}

function isPushResponse(value: unknown): value is { results: Array<{ entityType: SyncEntity["entityType"]; entityId: string; success: boolean; operation: "upload_create" | "upload_update"; cloudRevision: number | null; errorCode: string | null }> } {
  if (!value || typeof value !== "object" || !("results" in value) || !Array.isArray(value.results)) return false;
  return value.results.every((item) => item && typeof item === "object" && (item.entityType === "report" || item.entityType === "pdca") && typeof item.entityId === "string" && typeof item.success === "boolean" && (item.operation === "upload_create" || item.operation === "upload_update") && (item.cloudRevision === null || (typeof item.cloudRevision === "number" && Number.isInteger(item.cloudRevision) && item.cloudRevision > 0)) && (item.errorCode === null || typeof item.errorCode === "string"));
}

export type SyncPushOptions = {
  onBatch?: (results: SyncPushResult[]) => void | Promise<void>;
  shouldCancel?: () => boolean;
};

function syntheticBatchFailure(entities: SyncEntity[], errorCode: string): SyncPushResult[] {
  return entities.map((entity) => ({ entityType: entity.entityType, entityId: entity.entityId, success: false, operation: entity.revision ? "upload_update" : "upload_create", cloudRevision: entity.revision ?? null, errorCode, hash: entity.hash, updatedAt: entity.updatedAt ?? null }));
}

function exactBatchResults(entities: SyncEntity[], value: unknown): SyncPushResult[] | null {
  if (!isPushResponse(value) || value.results.length !== entities.length) return null;
  const expected = new Set(entities.map((item) => `${item.entityType}:${item.entityId}`));
  const seen = new Set<string>();
  const results: SyncPushResult[] = [];
  for (const item of value.results) {
    const key = `${item.entityType}:${item.entityId}`;
    if (!expected.has(key) || seen.has(key)) return null;
    seen.add(key);
    const source = entities.find((entity) => `${entity.entityType}:${entity.entityId}` === key);
    if (!source) return null;
    results.push({ ...item, hash: source.hash, updatedAt: source.updatedAt ?? null });
  }
  return seen.size === expected.size ? results : null;
}

export async function syncPush(deviceId: string, entities: Omit<SyncEntity, "hash">[], transport: typeof fetch = fetch, options: SyncPushOptions = {}): Promise<SyncPushResult[]> {
  const batches: SyncEntity[][] = [];
  for (let index = 0; index < entities.length; index += SYNC_BATCH_SIZE) {
    // Hash exactly the same canonical payload used by the planner. Otherwise a
    // harmless key-order difference can make the next scan look like a conflict.
    const batch = await Promise.all(entities.slice(index, index + SYNC_BATCH_SIZE).map(async (entity) => ({ ...entity, hash: await syncPayloadHash(entity.entityType, entity.payload) })));
    batches.push(batch);
  }
  const results: SyncPushResult[] = [];
  for (let index = 0; index < batches.length; index += 1) {
    const entitiesBatch = batches[index];
    if (options.shouldCancel?.()) {
      const cancelled = batches.slice(index).flatMap((batch) => syntheticBatchFailure(batch, "CLOUD_CANCELLED"));
      results.push(...cancelled);
      await options.onBatch?.(cancelled);
      break;
    }
    let batchResults: SyncPushResult[];
    try {
      const response = await transport("/api/cloud/sync/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId, entities: entitiesBatch }) });
      const body: unknown = await response.json().catch(() => null);
      batchResults = response.ok ? exactBatchResults(entitiesBatch, body) ?? syntheticBatchFailure(entitiesBatch, "CLOUD_TEMPORARILY_UNAVAILABLE") : syntheticBatchFailure(entitiesBatch, "CLOUD_TEMPORARILY_UNAVAILABLE");
    } catch {
      batchResults = syntheticBatchFailure(entitiesBatch, "CLOUD_TEMPORARILY_UNAVAILABLE");
    }
    results.push(...batchResults);
    await options.onBatch?.(batchResults);
  }
  return results;
}
