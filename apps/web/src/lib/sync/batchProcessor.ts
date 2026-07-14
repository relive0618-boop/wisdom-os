export const CLOUD_BATCH_SIZE = 25;
export function batches<T>(items: T[]) { return Array.from({ length: Math.ceil(items.length / CLOUD_BATCH_SIZE) }, (_, index) => items.slice(index * CLOUD_BATCH_SIZE, (index + 1) * CLOUD_BATCH_SIZE)); }
export type BatchResult = { entityType: string; entityId: string; success: boolean; operation: string; cloudRevision: number | null; errorCode: string | null };
export function summarizeResults(results: BatchResult[]) { return { success: results.filter((item) => item.success).length, failed: results.filter((item) => !item.success).length, conflicts: results.filter((item) => item.errorCode === "CLOUD_CONFLICT").length, retry: results.filter((item) => !item.success && item.errorCode !== "CLOUD_CONFLICT") }; }
