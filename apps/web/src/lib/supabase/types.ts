export type CloudEntityMeta = {
  revision: number;
  deviceId: string | null;
  clientUpdatedAt: string | null;
  updatedAt: string;
  deletedAt: string | null;
};

export type CloudReportRow = CloudEntityMeta & { reportId: string; decisionId: string; title: string | null; category: string | null; payload: unknown; analysisMeta: unknown };
export type CloudPdcaRow = CloudEntityMeta & { cycleId: string; reportId: string; payload: unknown };
export type CloudErrorCode = "CLOUD_NOT_CONFIGURED" | "AUTH_REQUIRED" | "CLOUD_FORBIDDEN" | "CLOUD_INVALID_INPUT" | "CLOUD_NOT_FOUND" | "CLOUD_CONFLICT" | "CLOUD_RATE_LIMITED" | "CLOUD_TEMPORARILY_UNAVAILABLE" | "CLOUD_INTERNAL_ERROR";
