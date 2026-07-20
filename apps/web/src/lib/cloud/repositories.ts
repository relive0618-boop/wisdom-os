"use client";

import type { AnalyzeResponse, PdcaCycle } from "@wisdom/shared";
import { listReports, loadReport, saveReport, type StoredReport } from "@/lib/reportStore";
import { listCycles, loadCycle, saveCycle } from "@/lib/pdca";

export interface ReportRepository { list(): StoredReport[]; get(reportId: string): StoredReport | null; save(report: AnalyzeResponse): StoredReport; }
export interface PdcaRepository { list(): PdcaCycle[]; get(cycleId: string): PdcaCycle | null; save(cycle: PdcaCycle): { ok: boolean }; }

export const localReportRepository: ReportRepository = { list: listReports, get: loadReport, save: saveReport };
export const localPdcaRepository: PdcaRepository = { list: listCycles, get: loadCycle, save: saveCycle };

async function cloudFetch(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error("CLOUD_SYNC_REQUEST_FAILED");
  return response.status === 204 ? null : response.json();
}

export const cloudReportRepository = {
  list: () => cloudFetch("/api/cloud/reports"),
  save: (payload: AnalyzeResponse, expectedRevision?: number) => cloudFetch("/api/cloud/reports", { method: "POST", body: JSON.stringify({ payload, expectedRevision: expectedRevision ?? null }) }),
};
export const cloudPdcaRepository = {
  list: () => cloudFetch("/api/cloud/pdca"),
  save: (payload: PdcaCycle, expectedRevision?: number) => cloudFetch("/api/cloud/pdca", { method: "POST", body: JSON.stringify({ payload, expectedRevision: expectedRevision ?? null }) }),
};
