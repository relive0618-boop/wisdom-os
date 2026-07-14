"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { StrategyCard } from "@/components/StrategyCard";
import {
  type PdcaCycle,
  type PdcaItem,
  type PdcaCheckin,
  generateInitialItems,
  loadCycle,
  saveCycle,
  createNewCycle,
  cycleProgress,
} from "@/lib/pdca";
import { loadReport, migrateLastReport, migrateLegacyCycles, type StoredReport } from "@/lib/reportStore";

// ─── Status badge ──────────────────────────────────────────────────────

function reportTitleFor(data: { report?: { problem_summary?: string } }) {
  return data.report?.problem_summary?.slice(0, 40) || "untitled";
}

// ─── Main component ────────────────────────────────────────────────────

function ReportContent() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<StoredReport | null>(null);
  const [cycle, setCycle] = useState<PdcaCycle | null>(null);
  const [showCheckin, setShowCheckin] = useState(false);
  const [showNewCycle, setShowNewCycle] = useState(false);

  // Copy report
  const [copied, setCopied] = useState(false);

  const reportTitle = data?.report?.problem_summary?.slice(0, 40) || "untitled";

  // Load report
  useEffect(() => {
    try {
      const reportId = searchParams.get("reportId");
      const requestedCycleId = searchParams.get("cycleId");
      const parsed = (reportId ? loadReport(reportId) : null) || (!reportId ? migrateLastReport() : null);
      if (parsed) {
        migrateLegacyCycles();
        window.setTimeout(() => {
          setData(parsed);
          let existing = loadCycle(requestedCycleId || parsed.cycleId);
          if (!existing) {
            const items = generateInitialItems(parsed.report);
            existing = createNewCycle(parsed.reportId, parsed.decisionId, reportTitleFor(parsed), parsed.report?.category || "综合决策", items, 1, requestedCycleId || parsed.cycleId);
            saveCycle(existing);
          }
          setCycle(existing);
        }, 0);
      }
    } catch { /* Invalid local data is treated as an empty report state. */ }
  }, [searchParams]);

  // Update a single item
  const updateItem = useCallback(
    (itemId: string, patch: Partial<PdcaItem>) => {
      if (!cycle || !data) return;
      const updated: PdcaCycle = {
        ...cycle,
        items: cycle.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
      };
      setCycle(updated);
      saveCycle(updated);
    },
    [cycle, data],
  );

  // Add a custom item
  const addCustomItem = useCallback(
    (text: string) => {
      if (!cycle || !data || !text.trim()) return;
      const newItem: PdcaItem = {
        id: `custom-${Date.now()}`,
        text: text.trim(),
        status: "pending",
        note: "",
        source: "custom",
        createdAt: new Date().toISOString(),
      };
      const updated: PdcaCycle = {
        ...cycle,
        items: [...cycle.items, newItem],
      };
      setCycle(updated);
      saveCycle(updated);
    },
    [cycle, data],
  );

  // Submit check-in
  const submitCheckin = useCallback(
    (checkin: PdcaCheckin) => {
      if (!cycle || !data) return;
      const updated: PdcaCycle = {
        ...cycle,
        checkins: [...cycle.checkins, checkin],
      };
      setCycle(updated);
      saveCycle(updated);
      setShowCheckin(false);
    },
    [cycle, data],
  );

  // Complete cycle with reflection
  const completeCycle = useCallback(
    (reflection: { outcome: string; keyLesson: string; nextFocus: string }) => {
      if (!cycle || !data) return;
      const updated: PdcaCycle = {
        ...cycle,
        completedAt: new Date().toISOString(),
        reflection,
      };
      setCycle(updated);
      saveCycle(updated);
    },
    [cycle, data],
  );

  // Start a new cycle
  const startNewCycle = useCallback(() => {
    if (!data) return;
    const nextNum = (cycle?.cycleNumber || 0) + 1;
    const items = generateInitialItems(data.report);
    // Carry over incomplete items
    const carryOver = (cycle?.items || [])
      .filter((i) => i.status !== "done")
      .map((i) => ({ ...i, id: `carry-${Date.now()}-${Math.random().toString(36).slice(2)}`, status: "pending" as const }));
    const all = [...carryOver, ...items];
    const newCycle = createNewCycle(data.reportId, data.decisionId, reportTitle, data.report?.category || "综合决策", all, nextNum);
    setCycle(newCycle);
    saveCycle(newCycle);
    setShowNewCycle(false);
  }, [cycle, data, reportTitle]);

  // Copy report summary
  const copyReport = async () => {
    if (!data) return;
    const r = data.report;
    const text = [
      `## ${r.category || "综合决策"}策略报告\n`,
      `**核心矛盾：**${r.core_conflict}\n`,
      `**局势判断：**${r.situation_assessment}\n`,
      `**推荐：**${r.recommended_strategy}\n`,
      `**风险：**${(r.risks || []).join("；")}\n`,
      `**七日行动：**\n${(r.action_plan_7d || []).map((a: string, i: number) => `${i + 1}. ${a}`).join("\n")}`,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!data) {
    return (
      <div className="flex flex-col items-center gap-4 py-32 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl border border-[#ded8cc] bg-[#fffdf9] font-serif text-2xl">
          策
        </div>
        <h2 className="text-xl font-semibold">尚未生成报告</h2>
        <p className="text-sm text-[#77786f]">先填写问题，系统会检索知识并生成三种行动策略。</p>
        <a
          href="/decision"
          className="rounded-xl bg-[#8a4d2e] px-6 py-3 font-bold text-white hover:bg-[#b46d43]"
        >
          开始分析
        </a>
      </div>
    );
  }

  const r = data.report;
  const prog = cycle ? cycleProgress(cycle.items) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-24 sm:p-8 sm:pb-8">
      {/* ===== Report Header ===== */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:gap-6">
        <div className="min-w-0">
          <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
            {r.mode === "remote" ? "Remote AI Report" : "Local Wisdom Report"}
          </span>
          <h2 className="font-serif text-2xl leading-tight sm:text-3xl">
            {r.category || "综合决策"}策略报告
          </h2>
          <p className="mt-2 leading-relaxed text-[#77786f]">{r.problem_summary}</p>
        </div>
        <button
          onClick={copyReport}
          className="shrink-0 rounded-xl border border-[#ded8cc] px-4 py-2 text-xs font-medium hover:bg-[#f4f1ea]"
        >
          {copied ? "已复制" : "复制摘要"}
        </button>
      </div>

      <section className="flex flex-wrap gap-2 rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-4 text-xs text-[#77786f]">
        <span className="rounded-full bg-[#eee9df] px-2.5 py-1">{r.mode === "remote" ? "Remote" : "Local"}</span>
        <span>Provider：{data.provider || "local"}</span>
        <span>Model：{data.model || "—"}</span>
        <span>Quality：{data.qualityScore ?? "—"}</span>
        <span>引用验证：{data.qualityPassed ? "通过" : "未通过"}</span>
        {data.remoteLatencyMs !== null && data.remoteLatencyMs !== undefined && <span>远端耗时：{(data.remoteLatencyMs / 1000).toFixed(1)} 秒</span>}
        <span>远端尝试：{data.remoteAttempts ?? 0}</span>
        {data.remoteRepaired && <span>已执行品质修复</span>}
        {data.remoteFinishReason && <span>Finish：{data.remoteFinishReason}</span>}
        <span>JSON：{data.remoteJsonExtraction ?? "not_attempted"}</span>
        {data.remoteContentLength !== null && data.remoteContentLength !== undefined && <span>Content：{data.remoteContentLength} 字符</span>}
        {data.remotePromptTokens !== null && data.remotePromptTokens !== undefined && <span>Prompt tokens：{data.remotePromptTokens}</span>}
        {data.remoteCompletionTokens !== null && data.remoteCompletionTokens !== undefined && <span>Completion tokens：{data.remoteCompletionTokens}</span>}
        {data.fallbackReason && <span>Fallback：{data.fallbackReason}</span>}
      </section>

      {/* Core Conflict & Situation */}
      <section className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-6">
        <h3 className="mb-3 text-sm font-semibold">核心矛盾</h3>
        <p className="leading-relaxed text-[#77786f]">{r.core_conflict}</p>
      </section>

      <section className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-6">
        <h3 className="mb-3 text-sm font-semibold">局势判断</h3>
        <p className="leading-relaxed text-[#77786f]">{r.situation_assessment}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {r.citations?.map((c, i) => (
            <span key={i} className="rounded-lg bg-[#eee9df] px-2 py-1 text-xs text-[#77786f]">
              {c.chapter} · {c.title}
            </span>
          ))}
        </div>
      </section>

      {/* Strategies */}
      <section className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-6">
        <h3 className="mb-4 text-sm font-semibold">三种策略方案</h3>
        <div className="grid gap-4 md:grid-cols-3">
          {r.strategies?.map((s, i) => (
            <StrategyCard
              key={i}
              name={s.name}
              position={s.position}
              actions={s.actions}
              suitableWhen={s.suitable_when}
              risk={s.risk}
              recommended={i === 1}
            />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-6">
        <h3 className="mb-3 text-sm font-semibold">推荐判断</h3>
        <p className="leading-relaxed text-[#77786f]">{r.recommended_strategy}</p>
      </section>

      <section className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-6">
        <h3 className="mb-4 text-sm font-semibold">风险清单</h3>
        <div className="space-y-2">
          {r.risks?.map((risk: string, i: number) => (
            <div key={i} className="rounded-xl bg-[#f4f1ea] px-4 py-3 text-xs leading-relaxed">
              <b className="mr-2 text-[#8a4d2e]">0{i + 1}</b>
              {risk}
            </div>
          ))}
        </div>
      </section>

      {/* ===== PDCA CYCLE ===== */}
      {cycle && (
        <div className="space-y-4">
          {/* ── Plan ── */}
          <section className="rounded-xl border border-[#8a4d2e]/30 bg-[#fffdf9] p-6 shadow-sm">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#8a4d2e] text-xs font-bold text-white">
                  P
                </span>
                <div>
                  <h3 className="text-sm font-semibold">Plan · 执行清单</h3>
                  <p className="text-xs text-[#77786f]">
                    第 {cycle.cycleNumber} 轮循环
                    {prog && ` · ${prog.done}/${prog.total} 项完成 (${prog.percent}%)`}
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              {prog && prog.total > 0 && (
                <div className="flex items-center gap-3">
                  <div className="hidden h-2 w-28 overflow-hidden rounded-full bg-[#eee9df] sm:block">
                    <div
                      className="h-full rounded-full bg-[#486451] transition-all"
                      style={{ width: `${prog.percent}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-[#486451]">{prog.percent}%</span>
                </div>
              )}
            </div>

            {/* Items */}
            <div className="space-y-1.5">
              {cycle.items.map((item) => (
                <div
                  key={item.id}
                  className="group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[#f4f1ea]"
                >
                  {/* Status selector */}
                  <select
                    value={item.status}
                    onChange={(e) => updateItem(item.id, { status: e.target.value as PdcaItem["status"] })}
                    className="mt-0.5 appearance-none rounded-lg border border-[#ded8cc] bg-white px-2 py-1 text-[10px] font-medium outline-none"
                  >
                    <option value="pending">待办</option>
                    <option value="in_progress">进行</option>
                    <option value="done">完成</option>
                    <option value="blocked">卡住</option>
                  </select>

                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm leading-relaxed ${
                        item.status === "done" ? "text-[#77786f] line-through" : ""
                      }`}
                    >
                      {item.text}
                    </p>
                    {item.note && (
                      <p className="mt-0.5 text-xs text-[#77786f]">{item.note}</p>
                    )}
                  </div>

                  {/* Note button */}
                  <button
                    onClick={() => {
                      const note = prompt("添加备注：", item.note || "");
                      if (note !== null) updateItem(item.id, { note });
                    }}
                    className="shrink-0 rounded-lg border border-transparent px-2 py-1 text-[10px] text-[#77786f] opacity-0 transition-all hover:border-[#ded8cc] hover:bg-white group-hover:opacity-100"
                  >
                    备注
                  </button>
                </div>
              ))}
            </div>

            {/* Add custom item */}
            <div className="mt-3 flex gap-2">
              <input
                placeholder="添加自定义行动..."
                className="flex-1 rounded-xl border border-[#ded8cc] bg-[#f4f1ea] px-4 py-2 text-sm outline-none focus:border-[#8a4d2e]"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    addCustomItem((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).value = "";
                  }
                }}
              />
              <span className="self-center text-[11px] text-[#77786f]">Enter 添加</span>
            </div>
          </section>

          {/* ── Check ── */}
          <section className="rounded-xl border border-blue-200 bg-[#fffdf9] p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-xs font-bold text-white">
                  C
                </span>
                <div>
                  <h3 className="text-sm font-semibold">Check · 复盘记录</h3>
                  <p className="text-xs text-[#77786f]">
                    {cycle.checkins.length
                      ? `${cycle.checkins.length} 次复盘`
                      : "还没做过复盘"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCheckin(true)}
                className="rounded-xl border border-[#ded8cc] px-4 py-2 text-xs font-medium hover:bg-[#f4f1ea]"
              >
                + 记录复盘
              </button>
            </div>

            {/* Checkin list */}
            {cycle.checkins.length > 0 && (
              <div className="space-y-3">
                {[...cycle.checkins].reverse().map((ck) => (
                  <div key={ck.id} className="rounded-xl border border-[#ded8cc] bg-[#f4f1ea] p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium">
                        {new Date(ck.date).toLocaleDateString("zh-CN")}
                      </span>
                    </div>
                    <div className="grid gap-2 text-xs leading-relaxed sm:grid-cols-2">
                      <div>
                        <b className="text-green-700">有效：</b>
                        <p className="mt-0.5 text-[#77786f]">{ck.whatWorked}</p>
                      </div>
                      <div>
                        <b className="text-red-600">无效：</b>
                        <p className="mt-0.5 text-[#77786f]">{ck.whatDidnt}</p>
                      </div>
                      <div>
                        <b>学到：</b>
                        <p className="mt-0.5 text-[#77786f]">{ck.lesson}</p>
                      </div>
                      <div>
                        <b>调整：</b>
                        <p className="mt-0.5 text-[#77786f]">{ck.adjustNext}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Act ── */}
          <section className="rounded-xl border border-green-200 bg-[#fffdf9] p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-green-600 text-xs font-bold text-white">
                  A
                </span>
                <div>
                  <h3 className="text-sm font-semibold">Act · 改善与下一轮</h3>
                  <p className="text-xs text-[#77786f]">
                    {cycle.completedAt
                      ? `本轮已完结 (${new Date(cycle.completedAt).toLocaleDateString("zh-CN")})`
                      : cycle.items.some((i) => i.status === "done")
                        ? "有进展，考虑开始下一轮"
                        : "先执行一些行动再回来"}
                  </p>
                </div>
              </div>

              {!cycle.completedAt && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowNewCycle(true)}
                    className="rounded-xl border border-[#8a4d2e] px-4 py-2 text-xs font-medium text-[#8a4d2e] hover:bg-[#f4f1ea]"
                  >
                    开启下一轮
                  </button>
                </div>
              )}
            </div>

            {/* Reflection for completed cycles */}
            {cycle.reflection && (
              <div className="mt-4 rounded-xl border border-[#ded8cc] bg-[#f4f1ea] p-4">
                <div className="grid gap-3 text-xs leading-relaxed sm:grid-cols-3">
                  <div>
                    <b>结果：</b>
                    <p className="mt-0.5 text-[#77786f]">{cycle.reflection.outcome}</p>
                  </div>
                  <div>
                    <b>关键教训：</b>
                    <p className="mt-0.5 text-[#77786f]">{cycle.reflection.keyLesson}</p>
                  </div>
                  <div>
                    <b>下阶段重点：</b>
                    <p className="mt-0.5 text-[#77786f]">{cycle.reflection.nextFocus}</p>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ===== Review Questions ===== */}
      <section className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-6">
        <h3 className="mb-4 text-sm font-semibold">复盘问题</h3>
        <div className="space-y-2">
          {r.review_questions?.map((q: string, i: number) => (
            <div key={i} className="rounded-xl bg-[#f4f1ea] px-4 py-3 text-xs leading-relaxed">
              {q}
            </div>
          ))}
        </div>
      </section>

      {/* Citations */}
      {r.citations && r.citations.length > 0 && (
        <section className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-6">
          <h3 className="mb-4 text-sm font-semibold">引用来源</h3>
          <div className="space-y-4">
            {r.citations.map((c, i) => (
              <div key={i} className="border-b border-[#ded8cc] pb-4 last:border-0">
                <span className="text-xs font-bold text-[#8a4d2e]">{c.chapter}</span>
                <h4 className="text-sm font-semibold">{c.title}</h4>
                <blockquote className="my-2 font-serif italic leading-relaxed text-[#77786f]">
                  {c.source}
                </blockquote>
                {c.explanation && (
                  <p className="text-xs leading-relaxed text-[#77786f]">{c.explanation}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-center text-xs text-[#77786f]">{r.disclaimer}</p>

      {/* ── Checkin Modal ── */}
      {showCheckin && (
        <CheckinModal
          onClose={() => setShowCheckin(false)}
          onSubmit={(ck) => submitCheckin(ck)}
        />
      )}

      {/* ── New Cycle Modal ── */}
      {showNewCycle && !cycle?.completedAt && (
        <NewCycleModal
          onClose={() => setShowNewCycle(false)}
          onConfirm={(outcome, keyLesson, nextFocus) => {
            completeCycle({ outcome, keyLesson, nextFocus });
            setShowNewCycle(false);
            // Small delay then start new cycle
            setTimeout(() => {
              startNewCycle();
            }, 300);
          }}
          cycleNumber={cycle?.cycleNumber || 1}
        />
      )}
    </div>
  );
}

// ── Checkin Modal ──────────────────────────────────────────────────────

function CheckinModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (ck: PdcaCheckin) => void;
}) {
  const [form, setForm] = useState({ whatWorked: "", whatDidnt: "", lesson: "", adjustNext: "" });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-[#ded8cc] bg-[#fffdf9] p-6 shadow-xl">
        <h3 className="mb-1 text-base font-semibold">记录复盘</h3>
        <p className="mb-5 text-xs text-[#77786f]">
          诚实地回顾一下执行情况，这是 PDCA 循环的关键。
        </p>

        <div className="space-y-3">
          {([
            ["whatWorked", "什么做得好？", "哪些行动有效？为什么？"],
            ["whatDidnt", "什么做得不好？", "哪些行动没达到预期？原因是什么？"],
            ["lesson", "学到了什么？", "从执行过程中获得了什么洞见？"],
            ["adjustNext", "下一步怎么调整？", "下一轮应该改变什么？"],
          ] as const).map(([key, label, hint]) => (
            <label key={key} className="block">
              <span className="mb-1 block text-xs font-bold text-[#555]">{label}</span>
              <textarea
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                placeholder={hint}
                rows={2}
                className="w-full rounded-xl border border-[#ded8cc] bg-[#f4f1ea] px-4 py-2.5 text-sm outline-none focus:border-[#8a4d2e]"
              />
            </label>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-[#ded8cc] px-5 py-2.5 text-sm font-medium hover:bg-[#f4f1ea]"
          >
            取消
          </button>
          <button
            onClick={() => {
              const allFilled = form.whatWorked && form.whatDidnt && form.lesson && form.adjustNext;
              if (!allFilled) { alert("请填写所有字段"); return; }
              onSubmit({
                id: `ck-${Date.now()}`,
                date: new Date().toISOString(),
                ...form,
              });
            }}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
          >
            保存复盘
          </button>
        </div>
      </div>
    </div>
  );
}

// ── New Cycle Modal ────────────────────────────────────────────────────

function NewCycleModal({
  onClose,
  onConfirm,
  cycleNumber,
}: {
  onClose: () => void;
  onConfirm: (outcome: string, keyLesson: string, nextFocus: string) => void;
  cycleNumber: number;
}) {
  const [form, setForm] = useState({ outcome: "", keyLesson: "", nextFocus: "" });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-[#ded8cc] bg-[#fffdf9] p-6 shadow-xl">
        <h3 className="mb-1 text-base font-semibold">开启第 {cycleNumber + 1} 轮循环</h3>
        <p className="mb-5 text-xs text-[#77786f]">
          先总结本轮成果，然后进入下一轮改善循环。未完成的事项会自动带到下一轮。
        </p>

        <div className="space-y-3">
          {([
            ["outcome", "本轮总体结果如何？"],
            ["keyLesson", "最大的教训是什么？"],
            ["nextFocus", "下一轮要重点解决什么？"],
          ] as const).map(([key, label]) => (
            <label key={key} className="block">
              <span className="mb-1 block text-xs font-bold text-[#555]">{label}</span>
              <textarea
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                rows={2}
                className="w-full rounded-xl border border-[#ded8cc] bg-[#f4f1ea] px-4 py-2.5 text-sm outline-none focus:border-[#8a4d2e]"
              />
            </label>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-[#ded8cc] px-5 py-2.5 text-sm font-medium hover:bg-[#f4f1ea]"
          >
            取消
          </button>
          <button
            onClick={() => {
              if (!form.outcome || !form.keyLesson || !form.nextFocus) {
                alert("请填写所有字段");
                return;
              }
              onConfirm(form.outcome, form.keyLesson, form.nextFocus);
            }}
            className="rounded-xl bg-green-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-green-700"
          >
            确认 & 开始下一轮
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page export ────────────────────────────────────────────────────────

export default function ReportPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-32">
          <p className="text-sm text-[#77786f]">加载中...</p>
        </div>
      }
    >
      <ReportContent />
    </Suspense>
  );
}
