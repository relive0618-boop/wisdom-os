export function normalizeCloudTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}
