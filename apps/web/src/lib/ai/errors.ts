export const REMOTE_ERROR_CODES = [
  "REMOTE_NOT_CONFIGURED",
  "REMOTE_TIMEOUT",
  "REMOTE_HTTP_ERROR",
  "REMOTE_INVALID_JSON",
  "REMOTE_SCHEMA_INVALID",
  "REMOTE_CITATION_INVALID",
  "REMOTE_QUALITY_FAILED",
  "USER_SELECTED_LOCAL",
] as const;

export type RemoteErrorCode = (typeof REMOTE_ERROR_CODES)[number];

export function isTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
