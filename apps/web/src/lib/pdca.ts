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
}

// ─── LocalStorage key ───────────────────────────────────────────────────

function storageKey(reportTitle: string) {
  return `wisdom_pdca_${reportTitle}`;
}

// ─── Generate initial items from a report ───────────────────────────────

export function generateInitialItems(report: any): PdcaItem[] {
  const items: PdcaItem[] = [];

  // Extract items from 7-day action plan
  if (report.action_plan_7d) {
    report.action_plan_7d.forEach((action: string, i: number) => {
      items.push({
        id: `plan-${i}`,
        text: action,
        status: "pending",
        note: "",
        source: "action_plan",
        createdAt: new Date().toISOString(),
      });
    });
  }

  // Extract actions from each strategy
  if (report.strategies) {
    report.strategies.forEach((s: any, si: number) => {
      (s.actions || []).forEach((a: string, ai: number) => {
        items.push({
          id: `strat-${si}-${ai}`,
          text: `[${s.name}] ${a}`,
          status: "pending",
          note: "",
          source: "strategy",
          strategyName: s.name,
          createdAt: new Date().toISOString(),
        });
      });
    });
  }

  return items;
}

// ─── CRUD ───────────────────────────────────────────────────────────────

export function loadCycle(reportTitle: string): PdcaCycle | null {
  try {
    const raw = localStorage.getItem(storageKey(reportTitle));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveCycle(reportTitle: string, cycle: PdcaCycle) {
  localStorage.setItem(storageKey(reportTitle), JSON.stringify(cycle));
}

export function createNewCycle(
  reportTitle: string,
  reportCategory: string,
  items: PdcaItem[],
  cycleNumber: number,
): PdcaCycle {
  return {
    id: `cycle-${Date.now()}`,
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

// ─── Helper ─────────────────────────────────────────────────────────────

export function cycleProgress(items: PdcaItem[]) {
  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const blocked = items.filter((i) => i.status === "blocked").length;
  const inProgress = items.filter((i) => i.status === "in_progress").length;
  return { total, done, blocked, inProgress, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
}
