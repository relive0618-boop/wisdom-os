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
  const data = new TextEncoder().encode(JSON.stringify(value));
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

export async function syncPush(deviceId: string, entities: Omit<SyncEntity, "hash">[], transport: typeof fetch = fetch): Promise<SyncPushResult[]> {
  const batches: SyncEntity[][] = [];
  for (let index = 0; index < entities.length; index += SYNC_BATCH_SIZE) {
    const batch = await Promise.all(entities.slice(index, index + SYNC_BATCH_SIZE).map(async (entity) => ({ ...entity, hash: await stableHash(entity.payload) })));
    batches.push(batch);
  }
  const results: SyncPushResult[] = [];
  for (const entitiesBatch of batches) {
    const response = await transport("/api/cloud/sync/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId, entities: entitiesBatch }) });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !isPushResponse(body)) throw new Error("CLOUD_SYNC_REQUEST_FAILED");
    for (const item of body.results) {
      const source = entitiesBatch.find((entity) => entity.entityType === item.entityType && entity.entityId === item.entityId);
      if (!source) throw new Error("CLOUD_SYNC_RESPONSE_INVALID");
      results.push({ ...item, hash: source.hash, updatedAt: source.updatedAt ?? null });
    }
  }
  return results;
}
