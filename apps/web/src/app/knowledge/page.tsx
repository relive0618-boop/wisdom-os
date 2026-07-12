"use client";

import { useEffect, useState } from "react";

interface KnowledgeItem {
  id: string;
  chapter: string;
  title: string;
  source: string;
  plain: string;
  principle: string;
  counterexamples?: string;
  applications: string[];
  limits: string[];
  tags: string[];
  case_ids?: string[];
}

export default function KnowledgePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [chapters, setChapters] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [chapter, setChapter] = useState("");

  useEffect(() => {
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then((d) => {
        setItems(d.knowledge);
        setChapters([...new Set(d.knowledge.map((k: KnowledgeItem) => k.chapter))]);
      });
  }, []);

  const filtered = items.filter((k) => {
    const hay = [
      k.title,
      k.chapter,
      k.plain,
      k.principle,
      k.counterexamples || "",
      ...k.tags,
      ...k.applications,
    ]
      .join(" ")
      .toLowerCase();
    const matchSearch = !search || hay.includes(search.toLowerCase());
    const matchChapter = !chapter || k.chapter === chapter;
    return matchSearch && matchChapter;
  });

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex flex-wrap gap-4">
        <div className="flex flex-1 items-center gap-3 rounded-xl border border-[#ded8cc] bg-[#fffdf9] px-4">
          <span className="text-[#77786f]">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索原文、原则、场景或标签"
            className="flex-1 border-0 bg-transparent py-3 text-sm outline-none"
          />
        </div>
        <select
          value={chapter}
          onChange={(e) => setChapter(e.target.value)}
          className="w-48 rounded-xl border border-[#ded8cc] bg-[#fffdf9] px-4 py-3 text-sm outline-none"
        >
          <option value="">全部十三篇</option>
          {chapters.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Chapter chips */}
      <div className="mb-6 flex gap-2 overflow-auto pb-2">
        {["", ...chapters].map((c) => (
          <button
            key={c || "all"}
            onClick={() => setChapter(c)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] ${
              chapter === c
                ? "border-transparent bg-[#20221f] text-[#fffdf9]"
                : "border-[#ded8cc] bg-[#fffdf9] text-[#77786f]"
            }`}
          >
            {c || "全部"}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((k) => (
          <article key={k.id} className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
                  {k.chapter}
                </span>
                <h3 className="mb-3 mt-1 text-base font-semibold">{k.title}</h3>
              </div>
              <span className="shrink-0 rounded-full bg-[#eee9df] px-2.5 py-1 text-[10px] text-[#77786f]">
                权威资料
              </span>
            </div>

            <blockquote className="mb-3 border-l-2 border-[#8a4d2e] pl-3 font-serif leading-relaxed">
              {k.source}
            </blockquote>

            <p className="mb-2 text-sm leading-relaxed text-[#77786f]">{k.plain}</p>
            <p className="mb-3 text-sm leading-relaxed">
              <b>决策原则：</b>
              {k.principle}
            </p>

            {/* Counterexamples */}
            {k.counterexamples && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-bold text-amber-800">⚠ 误用风险</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-700">{k.counterexamples}</p>
              </div>
            )}

            {/* Limits */}
            {k.limits && k.limits.length > 0 && (
              <div className="mb-3 space-y-1">
                {k.limits.map((l, i) => (
                  <p key={i} className="text-xs leading-relaxed text-[#77786f]">
                    <b>边界：</b>
                    {l}
                  </p>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {k.tags.map((t) => (
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
