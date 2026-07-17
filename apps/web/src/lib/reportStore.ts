import { z } from "zod";
import {
  AnalyzeResponseSchema,
  PdcaCheckinSchema,
  PdcaCycleSchema,
  PdcaItemSchema,
  ReportSchema,
  type AnalyzeResponse,
} from "@wisdom/shared";
import {
  createNewCycle,
  generateInitialItems,
  loadCycle,
  saveCycle,
} from "@/lib/pdca";

export const StoredReportSchema = AnalyzeResponseSchema.extend({
  createdAt: z.string().min(1),
});

export type StoredReport = z.infer<typeof StoredReportSchema>;

const REPORTS_KEY = "wisdom_reports_v1";
const LAST_REPORT_MIGRATION_KEY = "wisdom_last_report_migration_v1";
const LEGACY_PDCA_PREFIX = "wisdom_pdca_";
const NEW_PDCA_PREFIX = "wisdom_pdca_cycle_";

function readAll(): StoredReport[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(REPORTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const result = StoredReportSchema.safeParse(item);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

function writeAll(reports: StoredReport[]) {
  try {
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
  } catch {
    throw new Error("REPORT_STORAGE_SAVE_FAILED");
  }
}

export function saveReport(response: AnalyzeResponse): StoredReport {
  const parsed = AnalyzeResponseSchema.safeParse(response);
  if (!parsed.success) throw new Error("REPORT_STORAGE_SAVE_FAILED");
  const record = StoredReportSchema.parse({
    ...parsed.data,
    createdAt: new Date().toISOString(),
  });
  const reports = readAll().filter((item) => item.reportId !== record.reportId);
  writeAll([record, ...reports]);
  return record;
}

export function restoreReport(
  response: AnalyzeResponse,
  createdAt: string,
): { ok: true; record: StoredReport } | { ok: false; code: "REPORT_ALREADY_EXISTS" | "REPORT_STORAGE_SAVE_FAILED" } {
  const parsed = AnalyzeResponseSchema.safeParse(response);
  if (!parsed.success) return { ok: false, code: "REPORT_STORAGE_SAVE_FAILED" };
  if (loadReport(parsed.data.reportId)) return { ok: false, code: "REPORT_ALREADY_EXISTS" };
  const record = StoredReportSchema.safeParse({ ...parsed.data, createdAt });
  if (!record.success) return { ok: false, code: "REPORT_STORAGE_SAVE_FAILED" };
  try {
    writeAll([record.data, ...readAll()]);
    return { ok: true, record: record.data };
  } catch {
    return { ok: false, code: "REPORT_STORAGE_SAVE_FAILED" };
  }
}

export function loadReport(reportId: string): StoredReport | null {
  return readAll().find((item) => item.reportId === reportId) || null;
}

export function listReports(): StoredReport[] {
  return readAll().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function removeAllReports() {
  try {
    localStorage.removeItem(REPORTS_KEY);
  } catch {
    // Safe no-op when storage is unavailable.
  }
}

function ensureInitialCycle(response: StoredReport) {
  if (loadCycle(response.cycleId)) return;
  const cycle = createNewCycle(
    response.reportId,
    response.decisionId,
    response.report.problem_summary.slice(0, 40),
    response.report.category || "综合决策",
    generateInitialItems(response.report),
    1,
    response.cycleId,
  );
  saveCycle(cycle);
}

function legacyReport(title: string, decisionId: string, reportId: string, cycleId: string): AnalyzeResponse {
  const report = ReportSchema.parse({
    decisionId,
    reportId,
    mode: "local",
    category: "历史迁移",
    problem_summary: `迁移的旧版决策：${title || "未命名决策"}`,
    core_conflict: "这是一份从 v0.1 本地 PDCA 记录恢复的历史报告，原始报告内容不可用。",
    situation_assessment: "请将这份历史记录视为执行轨迹，并在新的决策分析中补充完整背景。",
    citations: [
      { id: "legacy-1", chapter: "历史迁移", title: "旧版记录", source: "旧版数据未包含可验证引用。" },
      { id: "legacy-2", chapter: "历史迁移", title: "旧版记录", source: "旧版数据未包含可验证引用。" },
    ],
    strategies: [
      { name: "历史记录", position: "保留旧执行轨迹。", actions: ["查看旧事项与复盘记录。"], suitable_when: "需要恢复历史数据。", risk: "原始报告内容可能不完整。" },
      { name: "重新分析", position: "补充背景后重新生成报告。", actions: ["重新填写决策问题与限制。"], suitable_when: "需要继续推进决策。", risk: "新报告与旧记录不一定完全一致。" },
    ],
    recommended_strategy: "先保留历史记录，再补充完整信息进行新的分析。",
    risks: ["历史报告内容不完整。"],
    action_plan_7d: Array.from({ length: 7 }, (_, index) => `迁移记录待处理事项 ${index + 1}`),
    review_questions: ["哪些旧记录仍然有效？"],
    disclaimer: "这是从旧版本地数据恢复的记录，不构成新的专业意见。",
  });
  return AnalyzeResponseSchema.parse({
    decisionId,
    reportId,
    cycleId,
    report,
    remoteError: null,
    retrievedAt: new Date().toISOString(),
  });
}

function normalizeLegacyLastReport(value: unknown): AnalyzeResponse | null {
  const current = AnalyzeResponseSchema.safeParse(value);
  if (current.success) return current.data;
  if (!value || typeof value !== "object" || !("report" in value)) return null;

  const legacy = value as { report?: Record<string, unknown>; retrievedAt?: string };
  const decisionId = crypto.randomUUID();
  const reportId = crypto.randomUUID();
  const cycleId = crypto.randomUUID();
  const report = ReportSchema.safeParse({
    ...legacy.report,
    decisionId,
    reportId,
    mode: legacy.report?.mode === "remote" ? "remote" : "local",
  });
  if (!report.success) return null;
  return AnalyzeResponseSchema.parse({
    decisionId,
    reportId,
    cycleId,
    report: report.data,
    remoteError: null,
    retrievedAt: legacy.retrievedAt || new Date().toISOString(),
  });
}

export function migrateLastReport(): StoredReport | null {
  if (typeof window === "undefined") return null;
  try {
    const marker = localStorage.getItem(LAST_REPORT_MIGRATION_KEY);
    if (marker) {
      const saved = loadReport(JSON.parse(marker).reportId);
      if (saved) {
        ensureInitialCycle(saved);
        migrateLegacyCycles();
        return saved;
      }
    }

    const raw = sessionStorage.getItem("lastReport");
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const response = normalizeLegacyLastReport(parsed);
    if (!response) return null;
    const saved = saveReport(response);
    ensureInitialCycle(saved);
    localStorage.setItem(LAST_REPORT_MIGRATION_KEY, JSON.stringify({ reportId: saved.reportId }));
    sessionStorage.removeItem("lastReport");
    migrateLegacyCycles();
    return saved;
  } catch {
    return null;
  }
}

const LegacyCycleSchema = z.object({
  id: z.string().optional(),
  cycleNumber: z.number().int().positive().default(1),
  reportTitle: z.string().default("未命名决策"),
  reportCategory: z.string().default("综合决策"),
  startedAt: z.string().default(new Date().toISOString()),
  completedAt: z.string().nullable().default(null),
  items: z.array(PdcaItemSchema),
  checkins: z.array(PdcaCheckinSchema),
  reflection: z.object({ outcome: z.string(), keyLesson: z.string(), nextFocus: z.string() }).nullable().default(null),
}).passthrough();

export function migrateLegacyCycles(): number {
  if (typeof window === "undefined") return 0;
  let migrated = 0;
  const reports = listReports();
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key) keys.push(key);
  }
  const legacyKeys = keys.filter(
    (key) => key.startsWith(LEGACY_PDCA_PREFIX) && !key.startsWith(NEW_PDCA_PREFIX),
  );

  for (const legacyKey of legacyKeys) {
    try {
      const parsed = LegacyCycleSchema.safeParse(JSON.parse(localStorage.getItem(legacyKey) || ""));
      if (!parsed.success) continue;
      const old = parsed.data;
      const title = legacyKey.slice(LEGACY_PDCA_PREFIX.length) || old.reportTitle;
      let report = reports.find((item) => item.report.problem_summary.includes(title));
      const cycleId = crypto.randomUUID();
      if (!report) {
        const decisionId = crypto.randomUUID();
        const reportId = crypto.randomUUID();
        report = saveReport(legacyReport(title, decisionId, reportId, cycleId));
        reports.push(report);
      }

      const cycle = PdcaCycleSchema.safeParse({
        id: cycleId,
        cycleId,
        reportId: report.reportId,
        decisionId: report.decisionId,
        cycleNumber: old.cycleNumber,
        reportTitle: old.reportTitle || title,
        reportCategory: old.reportCategory,
        startedAt: old.startedAt,
        completedAt: old.completedAt,
        items: old.items,
        checkins: old.checkins,
        reflection: old.reflection,
        legacyKey,
      });
      if (!cycle.success) continue;
      const stored = saveCycle(cycle.data);
      if (!stored.ok) continue;
      localStorage.removeItem(legacyKey);
      migrated += 1;
    } catch {
      // Failed migrations keep the legacy key for a future retry.
    }
  }
  return migrated;
}
