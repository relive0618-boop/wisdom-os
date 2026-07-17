import { PdcaCycleSchema, type Report } from "@wisdom/shared";

export interface PdcaItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "done" | "blocked";
  note: string;
  source: "strategy" | "action_plan" | "custom";
  strategyName?: string;
  createdAt: string;
}

export interface PdcaCheckin {
  id: string;
  date: string;
  whatWorked: string;
  whatDidnt: string;
  lesson: string;
  adjustNext: string;
}

export interface PdcaCycle {
  id: string;
  cycleId: string;
  reportId: string;
  decisionId: string;
  cycleNumber: number;
  reportTitle: string;
  reportCategory: string;
  startedAt: string;
  completedAt: string | null;
  items: PdcaItem[];
  checkins: PdcaCheckin[];
  reflection: {
    outcome: string;
    keyLesson: string;
    nextFocus: string;
  } | null;
  legacyKey?: string;
}

const CYCLE_PREFIX = "wisdom_pdca_cycle_";

export function generateInitialItems(report: Report): PdcaItem[] {
  const createdAt = new Date().toISOString();
  const items: PdcaItem[] = [];
  (report.action_plan_7d || []).forEach((action: string, i: number) => {
    items.push({ id: `plan-${i}-${crypto.randomUUID()}`, text: action, status: "pending", note: "", source: "action_plan", createdAt });
  });
  report.strategies.forEach((s) => {
    (s.actions || []).forEach((action: string) => {
      items.push({ id: `strategy-${crypto.randomUUID()}`, text: `[${s.name}] ${action}`, status: "pending", note: "", source: "strategy", strategyName: s.name, createdAt });
    });
  });
  return items;
}

export function createNewCycle(
  reportId: string,
  decisionId: string,
  reportTitle: string,
  reportCategory: string,
  items: PdcaItem[],
  cycleNumber: number,
  cycleId = crypto.randomUUID(),
): PdcaCycle {
  return {
    id: cycleId,
    cycleId,
    reportId,
    decisionId,
    cycleNumber,
    reportTitle,
    reportCategory,
    startedAt: new Date().toISOString(),
    completedAt: null,
    items,
    checkins: [],
    reflection: null,
  };
}

export function loadCycle(cycleId: string): PdcaCycle | null {
  try {
    const raw = localStorage.getItem(`${CYCLE_PREFIX}${cycleId}`);
    if (!raw) return null;
    const parsed = PdcaCycleSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveCycle(cycle: PdcaCycle): { ok: true } | { ok: false; code: "PDCA_STORAGE_SAVE_FAILED" } {
  const parsed = PdcaCycleSchema.safeParse(cycle);
  if (!parsed.success) return { ok: false, code: "PDCA_STORAGE_SAVE_FAILED" };
  try {
    localStorage.setItem(`${CYCLE_PREFIX}${cycle.cycleId}`, JSON.stringify(parsed.data));
    return { ok: true };
  } catch {
    return { ok: false, code: "PDCA_STORAGE_SAVE_FAILED" };
  }
}

export function restoreCycle(cycle: PdcaCycle): { ok: true } | { ok: false; code: "PDCA_CYCLE_ALREADY_EXISTS" | "PDCA_STORAGE_SAVE_FAILED" } {
  if (loadCycle(cycle.cycleId)) return { ok: false, code: "PDCA_CYCLE_ALREADY_EXISTS" };
  const result = saveCycle(cycle);
  return result.ok ? result : { ok: false, code: result.code };
}

export function listCycles(): PdcaCycle[] {
  if (typeof window === "undefined") return [];
  const cycles: PdcaCycle[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CYCLE_PREFIX)) continue;
    try {
      const parsed = PdcaCycleSchema.safeParse(JSON.parse(localStorage.getItem(key) || ""));
      if (parsed.success) cycles.push(parsed.data);
    } catch {
      // Ignore corrupt local records.
    }
  }
  return cycles.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export function removeAllCycles() {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key) keys.push(key);
  }
  keys
    .filter((key) => key.startsWith(CYCLE_PREFIX) || key.startsWith("wisdom_pdca_"))
    .forEach((key) => localStorage.removeItem(key));
}

export function cycleProgress(items: PdcaItem[]) {
  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const blocked = items.filter((i) => i.status === "blocked").length;
  const inProgress = items.filter((i) => i.status === "in_progress").length;
  return { total, done, blocked, inProgress, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
}
