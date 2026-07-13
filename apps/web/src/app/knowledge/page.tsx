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
      .then((d: { knowledge?: KnowledgeItem[] }) => {
        const knowledge = d.knowledge || [];
        setItems(knowledge);
        setChapters([...new Set(knowledge.map((k) => k.chapter))]);
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
    <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-8">
      {/* Search bar — simplified on mobile */}
      <div className="mb-4 flex gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-[#ded8cc] bg-[#fffdf9] px-3">
          <span className="text-[#77786f]">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索知识..."
            className="w-full border-0 bg-transparent py-2.5 text-sm outline-none md:py-3"
          />
        </div>
        <select
          value={chapter}
          onChange={(e) => setChapter(e.target.value)}
          className="w-auto shrink-0 rounded-xl border border-[#ded8cc] bg-[#fffdf9] px-3 py-2.5 text-sm outline-none md:w-48"
        >
          <option value="">全部</option>
          {chapters.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Chapter chips — scrollable strip */}
      <div className="mb-4 flex gap-2 overflow-auto pb-1 scrollbar-none">
        {["", ...chapters].map((c) => (
          <button
            key={c || "all"}
            onClick={() => setChapter(c)}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] ${
              chapter === c
                ? "border-transparent bg-[#20221f] text-[#fffdf9]"
                : "border-[#ded8cc] bg-[#fffdf9] text-[#77786f]"
            }`}
          >
            {c || "全部"}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {filtered.map((k) => (
          <article key={k.id} className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-4 md:p-5">
            {/* Header */}
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
                {k.chapter}
              </span>
              <span className="text-[10px] text-[#77786f]">/</span>
              <h3 className="text-sm font-semibold md:text-base">{k.title}</h3>
            </div>

            {/* Source quote — hidden on very small screens, kept with compact spacing */}
            <blockquote className="mb-2 border-l-2 border-[#8a4d2e] pl-3 text-xs leading-relaxed md:text-sm">
              {k.source.length > 60 ? k.source.slice(0, 60) + "…" : k.source}
            </blockquote>

            {/* Plain text — only show first ~100 chars on mobile with expand logic */}
            <p className="mb-1 text-xs leading-relaxed text-[#77786f] md:text-sm">
              {k.plain}
            </p>

            <p className="mb-2 text-xs leading-relaxed md:text-sm">
              <b>原则：</b>
              {k.principle}
            </p>

            {/* Counterexamples — collapsed as a subtle badge on mobile */}
            {k.counterexamples && (
              <details className="group mb-2">
                <summary className="cursor-pointer text-xs font-bold text-amber-700">
                  ⚠ 误用风险
                </summary>
                <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  {k.counterexamples}
                </p>
              </details>
            )}

            {/* Limits */}
            {k.limits && k.limits.length > 0 && (
              <div className="mb-2 space-y-0.5">
                {k.limits.map((l, i) => (
                  <p key={i} className="text-xs leading-relaxed text-[#77786f]">
                    <b>边界：</b>
                    {l}
                  </p>
                ))}
              </div>
            )}

            {/* Tags */}
            <div className="flex flex-wrap gap-1">
              {k.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-lg bg-[#eee9df] px-1.5 py-0.5 text-[10px] text-[#77786f]"
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
