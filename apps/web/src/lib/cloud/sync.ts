"use client";

import { SyncMetadataSchema, type SyncEntity, type SyncMetadata } from "@wisdom/shared";

export type SyncState = "idle" | "syncing" | "synced" | "offline" | "conflict" | "error";
export const SYNC_BATCH_SIZE = 25;
const METADATA_KEY = "wisdom_cloud_sync_metadata_v1";
const WIZARD_KEY = "wisdom_cloud_migration_v1";

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
export function conflictResolutionMetadata(metadata: SyncMetadata, strategy: "local" | "cloud" | "both", cloudRevision: number | null): SyncMetadata {
  return { ...metadata, cloudRevision, lastSyncedAt: new Date().toISOString(), syncState: strategy === "both" ? "pending_upload" : "synced", source: strategy === "local" ? "local" : strategy === "cloud" ? "cloud" : "both", pendingOperation: strategy === "local" ? "update" : "none", localBackupAt: strategy === "cloud" ? new Date().toISOString() : metadata.localBackupAt ?? null };
}

export async function stableHash(value: unknown) {
  const data = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function syncPush(deviceId: string, entities: Omit<SyncEntity, "hash">[]) {
  const batches = [];
  for (let index = 0; index < entities.length; index += SYNC_BATCH_SIZE) {
    const batch = await Promise.all(entities.slice(index, index + SYNC_BATCH_SIZE).map(async (entity) => ({ ...entity, hash: await stableHash(entity.payload) })));
    batches.push(batch);
  }
  for (const entitiesBatch of batches) {
    const response = await fetch("/api/cloud/sync/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId, entities: entitiesBatch }) });
    if (!response.ok) throw new Error("CLOUD_SYNC_REQUEST_FAILED");
  }
  return batches.length;
}
