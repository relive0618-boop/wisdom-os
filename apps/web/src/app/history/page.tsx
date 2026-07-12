"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PdcaCycle } from "@/lib/pdca";

export default function HistoryPage() {
  const [cycles, setCycles] = useState<PdcaCycle[]>([]);

  useEffect(() => {
    const all: PdcaCycle[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("wisdom_pdca_")) {
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || "");
          all.push(parsed);
        } catch {}
      }
    }
    all.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    setCycles(all);
  }, []);

  const done = (items: PdcaCycle["items"]) => items.filter((i) => i.status === "done").length;
  const total = (items: PdcaCycle["items"]) => items.length;

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
            History
          </span>
          <h2 className="mt-1 text-2xl font-semibold">决策历史</h2>
        </div>
        {cycles.length > 0 && (
          <button
            onClick={() => {
              if (confirm("确定清空所有历史记录？此操作不可撤销。")) {
                const keys = Object.keys(localStorage).filter((k) =>
                  k.startsWith("wisdom_pdca_"),
                );
                keys.forEach((k) => localStorage.removeItem(k));
                setCycles([]);
              }
            }}
            className="rounded-xl border border-[#ded8cc] px-4 py-2 text-xs font-medium hover:bg-[#f4f1ea]"
          >
            清空记录
          </button>
        )}
      </div>

      {cycles.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-32 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl border border-[#ded8cc] bg-[#fffdf9] font-serif text-2xl">
            时
          </div>
          <h2 className="text-xl font-semibold">还没有历史记录</h2>
          <p className="text-sm text-[#77786f]">完成第一次分析后，PDCA 循环会保存在这里。</p>
          <Link
            href="/decision"
            className="rounded-xl bg-[#8a4d2e] px-6 py-3 font-bold text-white hover:bg-[#b46d43]"
          >
            开始分析
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {cycles.map((c) => (
            <Link
              key={c.id}
              href="/report"
              className="block rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-5 transition-colors hover:border-[#8a4d2e]/30"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-[#eee9df] px-2 py-0.5 text-[10px] text-[#77786f]">
                      第 {c.cycleNumber} 轮
                    </span>
                    <span className="text-xs text-[#77786f]">
                      {new Date(c.startedAt).toLocaleDateString("zh-CN")}
                    </span>
                    {c.completedAt && (
                      <>
                        <span className="text-[#ded8cc]">→</span>
                        <span className="text-xs text-[#77786f]">
                          {new Date(c.completedAt).toLocaleDateString("zh-CN")}
                        </span>
                      </>
                    )}
                  </div>
                  <h3 className="mt-1 truncate text-base font-semibold">
                    {c.reportTitle || c.reportCategory}
                  </h3>
                  <p className="mt-2 text-xs text-[#77786f]">
                    {done(c.items)}/{total(c.items)} 项完成 · {c.checkins.length} 次复盘
                  </p>
                </div>

                {/* Mini progress */}
                <div className="flex w-12 flex-col items-center gap-1">
                  <div className="h-12 w-12 rounded-full border-2 border-[#ded8cc]">
                    <svg viewBox="0 0 36 36" className="h-12 w-12 -rotate-90">
                      <circle
                        cx="18"
                        cy="18"
                        r="15.5"
                        fill="none"
                        stroke="#eee9df"
                        strokeWidth="3"
                      />
                      <circle
                        cx="18"
                        cy="18"
                        r="15.5"
                        fill="none"
                        stroke="#486451"
                        strokeWidth="3"
                        strokeDasharray={`${(done(c.items) / Math.max(total(c.items), 1)) * 97} 97`}
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                  <span className="text-[10px] font-medium text-[#486451]">
                    {total(c.items) > 0 ? Math.round((done(c.items) / total(c.items)) * 100) : 0}%
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
