"use client";

import { useState } from "react";
import Link from "next/link";
import { listCycles, removeAllCycles, type PdcaCycle } from "@/lib/pdca";
import { listReports, migrateLastReport, migrateLegacyCycles, removeAllReports, type StoredReport } from "@/lib/reportStore";

export default function HistoryPage() {
  const [reports, setReports] = useState<StoredReport[]>(() => {
    if (typeof window === "undefined") return [];
    migrateLastReport();
    migrateLegacyCycles();
    return listReports();
  });
  const [cycles, setCycles] = useState<PdcaCycle[]>(() => (typeof window === "undefined" ? [] : listCycles()));

  function refresh() {
    setReports(listReports());
    setCycles(listCycles());
  }

  const cyclesFor = (reportId: string) => cycles.filter((cycle) => cycle.reportId === reportId);
  const done = (items: PdcaCycle["items"]) => items.filter((item) => item.status === "done").length;

  return (
    <div className="mx-auto max-w-4xl p-4 pb-24 sm:p-8 sm:pb-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-[var(--accent)]">History</span>
          <h2 className="mt-1 text-2xl font-semibold">决策历史</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">每份报告和每一轮 PDCA 都有独立记录。</p>
        </div>
        {(reports.length > 0 || cycles.length > 0) && (
          <button
            onClick={() => {
              if (confirm("确定清空所有历史记录？此操作不可撤销。")) {
                removeAllReports();
                removeAllCycles();
                refresh();
              }
            }}
            className="rounded-xl border border-[var(--line)] px-4 py-2 text-xs font-medium hover:bg-[var(--panel-2)]"
          >清空记录</button>
        )}
      </div>

      {reports.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-32 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl border border-[var(--line)] bg-[var(--panel)] font-serif text-2xl">时</div>
          <h2 className="text-xl font-semibold">还没有历史记录</h2>
          <p className="text-sm text-[var(--muted)]">完成第一次分析后，报告会保存在本机。</p>
          <Link href="/decision" className="rounded-xl bg-[var(--accent)] px-6 py-3 font-bold text-white hover:bg-[var(--accent-2)]">开始分析</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((record) => {
            const reportCycles = cyclesFor(record.reportId);
            const cycle = reportCycles[0];
            const items = cycle?.items || [];
            const completion = items.length ? Math.round((done(items) / items.length) * 100) : 0;
            return (
              <div key={record.reportId} className="space-y-2">
                <Link href={`/report?reportId=${encodeURIComponent(record.reportId)}`} className="block rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 transition-colors hover:border-[var(--accent)]/50 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[var(--panel-2)] px-2 py-0.5 text-[10px] text-[var(--muted)]">{record.report.mode === "remote" ? "远程 AI" : "本地引擎"}</span>
                      <span className="text-xs text-[var(--muted)]">{new Date(record.createdAt).toLocaleDateString("zh-CN")}</span>
                    {cycle && <span className="text-xs text-[var(--muted)]">第 {cycle.cycleNumber} 轮 · {completion}%</span>}
                    </div>
                    <h3 className="mt-2 truncate text-base font-semibold">{record.report.problem_summary}</h3>
                    <p className="mt-2 line-clamp-2 text-xs text-[var(--muted)]">{record.report.situation_assessment}</p>
                  </div>
                  <span className="shrink-0 text-lg text-[var(--accent)]">→</span>
                </div>
                </Link>
                {reportCycles.length > 1 && (
                  <div className="flex flex-wrap gap-2 px-2">
                    {reportCycles.map((item) => (
                      <Link
                        key={item.cycleId}
                        href={`/report?reportId=${encodeURIComponent(record.reportId)}&cycleId=${encodeURIComponent(item.cycleId)}`}
                        className="rounded-lg bg-[var(--panel-2)] px-2 py-1 text-[10px] text-[var(--muted)] hover:text-[var(--accent)]"
                      >
                        第 {item.cycleNumber} 轮 · {item.completedAt ? "已完成" : "进行中"}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
