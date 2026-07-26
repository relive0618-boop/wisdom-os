import { batches } from "./batchProcessor";
export type MigrationProgress = { processed: number; total: number; currentBatch: number; totalBatches: number; paused: boolean; cancelled: boolean; failedIds: string[] };
export function migrationProgress(ids: string[], processed = 0, failedIds: string[] = []): MigrationProgress { const groups = batches(ids); return { processed, total: ids.length, currentBatch: Math.min(Math.ceil(processed / 25), groups.length), totalBatches: groups.length, paused: false, cancelled: false, failedIds }; }
