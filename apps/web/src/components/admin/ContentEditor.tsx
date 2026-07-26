"use client";

import { useEffect, useState } from "react";
import { CaseSchema, KnowledgeItemSchema } from "@wisdom/shared";

type Kind = "knowledge" | "cases";
type Status = "draft" | "reviewed" | "published" | "archived";
type Fields = Record<string, string>;

const knowledgeFields = ["id", "chapter", "title", "source", "plain", "principle", "counterexamples", "applications", "limits", "tags", "case_ids"] as const;
const caseFields = ["id", "title", "scenario", "summary", "result", "lessons", "tags", "case_type", "source_title", "source_url", "source_date", "review_status"] as const;
const editableStatuses: Status[] = ["draft", "reviewed"];
const transitionTargets: Record<Status, Status[]> = { draft: ["reviewed"], reviewed: ["draft", "published"], published: ["archived"], archived: ["draft"] };

function listValue(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join("\n") : ""; }
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
function initialFields(kind: Kind, payload?: Record<string, unknown>): Fields {
  const fields: Fields = {};
  for (const key of kind === "knowledge" ? knowledgeFields : caseFields) fields[key] = "";
  if (!payload) return fields;
  for (const [key, value] of Object.entries(payload)) fields[key] = ["applications", "limits", "tags", "case_ids", "lessons"].includes(key) ? listValue(value) : stringValue(value);
  return fields;
}
function lines(value: string) { return value.split("\n").map((item) => item.trim()).filter(Boolean); }
function buildPayload(kind: Kind, fields: Fields) {
  if (kind === "knowledge") return {
    id: fields.id.trim(), chapter: fields.chapter.trim(), title: fields.title.trim(), source: fields.source.trim(), plain: fields.plain.trim(), principle: fields.principle.trim(),
    counterexamples: fields.counterexamples.trim() || undefined, applications: lines(fields.applications), limits: lines(fields.limits), tags: lines(fields.tags), case_ids: lines(fields.case_ids).length ? lines(fields.case_ids) : undefined,
  };
  return {
    id: fields.id.trim(), title: fields.title.trim(), scenario: fields.scenario.trim(), summary: fields.summary.trim(), result: fields.result.trim(), lessons: lines(fields.lessons), tags: lines(fields.tags),
    case_type: fields.case_type || "composite", source_title: fields.source_title.trim() || null, source_url: fields.source_url.trim() || null, source_date: fields.source_date.trim() || null, review_status: fields.review_status || "reviewed",
  };
}
function validate(kind: Kind, payload: unknown) { return kind === "knowledge" ? KnowledgeItemSchema.safeParse(payload) : CaseSchema.safeParse(payload); }

export function ContentEditor({ kind, contentId }: { kind: Kind; contentId?: string }) {
  const [fields, setFields] = useState<Fields>(() => initialFields(kind));
  const [status, setStatus] = useState<Status>("draft");
  const [loading, setLoading] = useState(Boolean(contentId));
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const isExisting = Boolean(contentId);
  const editable = editableStatuses.includes(status);

  useEffect(() => {
    if (!contentId) return;
    let active = true;
    void fetch(`/api/admin/content/${kind}/${encodeURIComponent(contentId)}`).then(async (response) => {
      const body = await response.json().catch(() => null) as { data?: { payload?: Record<string, unknown>; status?: Status } } | null;
      if (!response.ok || !body?.data?.payload || !body.data.status) throw new Error("CONTENT_LOAD_FAILED");
      if (active) { setFields(initialFields(kind, body.data.payload)); setStatus(body.data.status); }
    }).catch(() => { if (active) setFeedback("無法讀取資料，請稍後重試。"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [contentId, kind]);

  function update(key: string, value: string) { setFields((previous) => ({ ...previous, [key]: value })); }
  async function submit(nextStatus: Status) {
    const payload = buildPayload(kind, fields);
    const checked = validate(kind, payload);
    if (!checked.success) { setFeedback("請完成所有必填欄位並確認格式。 "); return; }
    setSubmitting(true); setFeedback("");
    try {
      const response = await fetch(`/api/admin/content/${kind}/${encodeURIComponent(checked.data.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: checked.data, status: nextStatus }) });
      if (!response.ok) throw new Error("CONTENT_SAVE_FAILED");
      setStatus(nextStatus); setFeedback(nextStatus === "published" ? "已發布。" : "已安全儲存。");
    } catch { setFeedback("無法完成操作，資料尚未變更。請稍後重試。"); } finally { setSubmitting(false); }
  }
  async function softDelete() {
    if (!contentId || !window.confirm("確認軟刪除此筆資料？之後不會出現在預設列表。")) return;
    setSubmitting(true); setFeedback("");
    try {
      const response = await fetch(`/api/admin/content/${kind}/${encodeURIComponent(contentId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("CONTENT_DELETE_FAILED");
      setFeedback("已軟刪除資料。");
    } catch { setFeedback("無法完成刪除，資料尚未變更。請稍後重試。"); } finally { setSubmitting(false); }
  }

  const labels: Record<string, string> = { id: "ID", chapter: "章節", title: "標題", source: "來源", plain: "原文摘要", principle: "核心原則", counterexamples: "反例", applications: "應用（每行一項）", limits: "限制（每行一項）", tags: "標籤（每行一項）", case_ids: "關聯案例 ID（每行一項）", scenario: "情境", summary: "摘要", result: "結果", lessons: "啟示（每行一項）", source_title: "來源標題", source_url: "來源網址", source_date: "來源日期" };
  const names = kind === "knowledge" ? knowledgeFields : caseFields;
  if (loading) return <p className="mt-5 text-sm">正在讀取管理資料…</p>;
  return <form className="mt-6 max-w-3xl space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(status); }}>
    {names.map((name) => {
      if (name === "case_type" || name === "review_status") return <label key={name} className="block text-sm">{name === "case_type" ? "案例類型" : "審核狀態"}<select disabled={submitting || !editable} value={fields[name]} onChange={(event) => update(name, event.target.value)} className="mt-1 block w-full rounded border p-2">{name === "case_type" ? <><option value="composite">composite</option><option value="real">real</option></> : <><option value="reviewed">reviewed</option><option value="pending">pending</option></>}</select></label>;
      const multiline = ["plain", "principle", "counterexamples", "applications", "limits", "tags", "case_ids", "scenario", "summary", "result", "lessons"].includes(name);
      return <label key={name} className="block text-sm">{labels[name]}{multiline ? <textarea required={!["counterexamples", "case_ids"].includes(name)} disabled={submitting || (!editable && isExisting) || (name === "id" && isExisting)} value={fields[name]} onChange={(event) => update(name, event.target.value)} className="mt-1 min-h-24 w-full rounded border p-2" /> : <input required={!["counterexamples", "case_ids", "source_title", "source_url", "source_date"].includes(name)} type={name === "source_date" ? "date" : "text"} disabled={submitting || (!editable && isExisting) || (name === "id" && isExisting)} value={fields[name]} onChange={(event) => update(name, event.target.value)} className="mt-1 w-full rounded border p-2" />}</label>;
    })}
    <div className="flex flex-wrap gap-2"><button type="submit" disabled={submitting || (isExisting && !editable)} className="rounded bg-[#20221f] px-4 py-2 text-sm text-white disabled:opacity-40">{submitting ? "處理中…" : "儲存"}</button>{isExisting && transitionTargets[status].map((target) => <button key={target} type="button" disabled={submitting} onClick={() => void submit(target)} className="rounded border px-4 py-2 text-sm">轉為 {target}</button>)}{isExisting && <button type="button" disabled={submitting} onClick={() => void softDelete()} className="rounded border border-red-700 px-4 py-2 text-sm text-red-700">軟刪除</button>}</div>
    {feedback && <p role="status" className="text-sm">{feedback}</p>}
  </form>;
}
