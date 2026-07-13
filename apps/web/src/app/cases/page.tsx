"use client";

import { useEffect, useState } from "react";

interface CaseItem {
  id: string;
  title: string;
  scenario: string;
  summary: string;
  result: string;
  lessons: string[];
  tags: string[];
  case_type: "real" | "composite";
  source_title: string | null;
  source_url: string | null;
  source_date: string | null;
  review_status: "reviewed" | "pending";
}

export default function CasesPage() {
  const [items, setItems] = useState<CaseItem[]>([]);

  useEffect(() => {
    fetch("/api/cases")
      .then((r) => r.json())
      .then((d) => setItems(d.cases));
  }, []);

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-6">
        <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
          Modern Cases
        </span>
        <h2 className="mt-1 text-2xl font-semibold">现代情境案例</h2>
        <p className="mt-1 text-sm text-[#77786f]">案例用于帮助理解原则，不代表结果可以复制。</p>
        <p className="mt-2 text-xs text-[#77786f]">情境化综合案例，仅用于理解策略，不代表实际结果。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((c) => (
          <article
            key={c.id}
            className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-6"
          >
            <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
              {c.scenario}
            </span>
            <span className="ml-2 rounded-full bg-[#eee9df] px-2 py-0.5 text-[10px] text-[#77786f]">
              {c.case_type === "composite" ? "综合案例" : "真实案例"}
            </span>
            <h3 className="mb-3 mt-1 text-base font-semibold">{c.title}</h3>
            <p className="mb-2 text-xs leading-relaxed text-[#77786f]">{c.summary}</p>
            <p className="mb-3 text-xs leading-relaxed">
              <b>结果：</b>
              {c.result}
            </p>
            <ul className="mb-3 space-y-1 pl-4">
              {c.lessons.map((l, i) => (
                <li key={i} className="text-xs leading-relaxed text-[#77786f]">
                  {l}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-1.5">
              {c.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-lg bg-[#eee9df] px-2 py-0.5 text-[10px] text-[#77786f]"
                >
                  {t}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
