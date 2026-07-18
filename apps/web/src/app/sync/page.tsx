"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listCycles, restoreCycle } from "@/lib/pdca";
import { listReports, restoreReport } from "@/lib/reportStore";
import {
  createMigrationState,
  getOrCreateDeviceId,
  loadMigrationState,
  metadataEntityId,
  parseCloudSnapshot,
  planCloudRestore,
  saveMigrationState,
  stableHash,
  syncPush,
  syncRepository,
  type MigrationState,
} from "@/lib/cloud/sync";

type CloudInfo = { configured: boolean; authEnabled: boolean; syncEnabled: boolean };
const emptyCloud: CloudInfo = { configured: false, authEnabled: false, syncEnabled: false };
const emptyCounts = { reports: 0, cycles: 0, cloudReports: 0, cloudCycles: 0 };

export default function SyncPage() {
  const [cloud, setCloud] = useState(emptyCloud);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [counts, setCounts] = useState(emptyCounts);
  const [downloadPreview, setDownloadPreview] = useState({ available: 0, conflicts: 0, invalid: 0 });
  const [migration, setMigration] = useState<MigrationState | null>(null);
  const [metadata, setMetadata] = useState(() => [] as ReturnType<typeof syncRepository.listMetadata>);
  const [message, setMessage] = useState("");

  function scan() {
    const reports = listReports();
    const cycles = listCycles();
    setCounts((previous) => ({ ...previous, reports: reports.length, cycles: cycles.length }));
    setMetadata(syncRepository.listMetadata());
    setMigration(loadMigrationState() ?? createMigrationState(reports.length + cycles.length));
  }

  async function loadCloudSnapshot() {
    const response = await fetch("/api/cloud/sync/pull", { method: "POST" });
    if (!response.ok) return null;
    const snapshot = parseCloudSnapshot(await response.json().catch(() => null));
    const plan = planCloudRestore(
      snapshot,
      listReports().map((item) => item.reportId),
      listCycles().map((item) => item.cycleId),
    );
    setCounts((previous) => ({
      ...previous,
      cloudReports: snapshot.reports.length,
      cloudCycles: snapshot.cycles.length,
    }));
    setDownloadPreview({
      available: plan.reports.length + plan.cycles.length,
      conflicts: plan.reportConflicts.length + plan.cycleConflicts.length,
      invalid: plan.invalid,
    });
    return { snapshot, plan };
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOnline(navigator.onLine);
      scan();
    }, 0);
    fetch("/api/health")
      .then((response) => response.json())
      .then((data) => {
        const next = data.cloud ?? emptyCloud;
        setCloud(next);
        if (next.configured) void loadCloudSnapshot();
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
    const offline = () => setOnline(false);
    const on = () => setOnline(true);
    window.addEventListener("offline", offline);
    window.addEventListener("online", on);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", on);
    };
  }, []);

  const status = (state: string) => metadata.filter((item) => item.syncState === state).length;

  function advance(step: MigrationState["step"]) {
    if (!migration) return;
    const next = { ...migration, step, updatedAt: new Date().toISOString() };
    saveMigrationState(next);
    setMigration(next);
  }

  async function sync() {
    if (!cloud.configured || !online) return;
    const reports = listReports();
    const cycles = listCycles();
    if (reports.length + cycles.length === 0) {
      setMessage("沒有可同步的本機資料。");
      return;
    }
    setMessage("正在同步…");
    const deviceId = getOrCreateDeviceId();
    const entities = [
      ...reports.map((item) => ({
        entityType: "report" as const,
        entityId: item.reportId,
        payload: item,
        revision: syncRepository.getMetadata(metadataEntityId("report", item.reportId))?.cloudRevision ?? null,
        updatedAt: item.createdAt,
        deletedAt: null,
        deviceId,
      })),
      ...cycles.map((item) => ({
        entityType: "pdca" as const,
        entityId: item.cycleId,
        payload: item,
        revision: syncRepository.getMetadata(metadataEntityId("pdca", item.cycleId))?.cloudRevision ?? null,
        updatedAt: item.startedAt,
        deletedAt: null,
        deviceId,
      })),
    ];
    try {
      const results = await syncPush(deviceId, entities);
      const syncedAt = new Date().toISOString();
      for (const result of results) {
        syncRepository.saveMetadata({
          entityId: metadataEntityId(result.entityType, result.entityId),
          localUpdatedAt: result.updatedAt ?? syncedAt,
          cloudRevision: result.cloudRevision,
          lastSyncedHash: result.success ? result.hash : null,
          lastSyncedAt: result.success ? syncedAt : null,
          syncState: result.success ? "synced" : result.errorCode === "CLOUD_CONFLICT" ? "conflict" : "error",
          source: result.success ? "both" : "local",
          pendingOperation: result.success ? "none" : "update",
        });
      }
      const succeeded = results.filter((item) => item.success).length;
      const failed = results.length - succeeded;
      scan();
      await loadCloudSnapshot();
      setMessage(failed === 0 ? `已安全同步 ${succeeded} 筆資料。` : `${succeeded} 筆已同步，${failed} 筆未完成；本機資料仍保留。`);
    } catch {
      setMessage("同步暫時無法完成；本機資料未受影響，可稍後重試。");
    }
  }

  async function download() {
    if (!cloud.configured || !online) return;
    setMessage("正在檢查並還原雲端資料…");
    try {
      const loaded = await loadCloudSnapshot();
      if (!loaded) {
        setMessage("暫時無法讀取雲端資料；本機資料未受影響，可稍後重試。");
        return;
      }
      const { plan } = loaded;
      const now = new Date().toISOString();
      let restored = 0;
      let failures = 0;

      for (const item of plan.reports) {
        const result = restoreReport(item.payload, item.clientUpdatedAt ?? item.updatedAt);
        if (!result.ok) {
          failures += 1;
          continue;
        }
        syncRepository.saveMetadata({
          entityId: metadataEntityId("report", item.reportId),
          localUpdatedAt: result.record.createdAt,
          cloudRevision: item.revision,
          lastSyncedHash: await stableHash(item.payload),
          lastSyncedAt: now,
          syncState: "synced",
          source: "both",
          pendingOperation: "none",
        });
        restored += 1;
      }

      for (const item of plan.cycles) {
        const result = restoreCycle(item.payload);
        if (!result.ok) {
          failures += 1;
          continue;
        }
        syncRepository.saveMetadata({
          entityId: metadataEntityId("pdca", item.cycleId),
          localUpdatedAt: item.payload.startedAt,
          cloudRevision: item.revision,
          lastSyncedHash: await stableHash(item.payload),
          lastSyncedAt: now,
          syncState: "synced",
          source: "both",
          pendingOperation: "none",
        });
        restored += 1;
      }

      for (const entityId of plan.reportConflicts) {
        const local = listReports().find((item) => item.reportId === entityId);
        const cloudRecord = loaded.snapshot.reports.find((item) => item.reportId === entityId);
        if (!local || !cloudRecord) continue;
        syncRepository.saveMetadata({
          entityId: metadataEntityId("report", entityId),
          localUpdatedAt: local.createdAt,
          cloudRevision: cloudRecord.revision,
          lastSyncedHash: null,
          lastSyncedAt: null,
          syncState: "conflict",
          source: "both",
          pendingOperation: "none",
        });
      }
      for (const entityId of plan.cycleConflicts) {
        const local = listCycles().find((item) => item.cycleId === entityId);
        const cloudRecord = loaded.snapshot.cycles.find((item) => item.cycleId === entityId);
        if (!local || !cloudRecord) continue;
        syncRepository.saveMetadata({
          entityId: metadataEntityId("pdca", entityId),
          localUpdatedAt: local.startedAt,
          cloudRevision: cloudRecord.revision,
          lastSyncedHash: null,
          lastSyncedAt: null,
          syncState: "conflict",
          source: "both",
          pendingOperation: "none",
        });
      }

      scan();
      await loadCloudSnapshot();
      const conflicts = plan.reportConflicts.length + plan.cycleConflicts.length;
      const invalid = plan.invalid + failures;
      setMessage(
        invalid > 0
          ? `已還原 ${restored} 筆；${conflicts} 筆同 ID 保留本機；${invalid} 筆未還原。`
          : `已還原 ${restored} 筆資料；${conflicts} 筆同 ID 已保留本機並標示衝突。`,
      );
    } catch {
      setMessage("還原暫時無法完成；本機資料未受影響，可稍後重試。");
    }
  }

  if (loading) return <section className="mx-auto max-w-4xl p-6 md:p-12">正在讀取同步狀態…</section>;

  return <section className="mx-auto max-w-4xl p-6 md:p-12">
    <p className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">Cloud sync</p>
    <h1 className="mt-2 font-serif text-3xl">同步與遷移</h1>
    <p className="mt-3 text-sm text-[#77786f]">本機資料始終優先。登入不會自動上傳、下載或刪除現有歷史資料。</p>
    <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[["雲端", cloud.configured ? "已配置" : "未配置"], ["網路", online ? "連線中" : "離線"], ["本機報告", String(counts.reports)], ["本機 PDCA", String(counts.cycles)], ["雲端報告", String(counts.cloudReports)], ["雲端 PDCA", String(counts.cloudCycles)], ["待上傳", String(status("pending_upload"))], ["衝突", String(status("conflict"))]].map(([label, value]) => <div key={label} className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-4"><div className="text-xs text-[#77786f]">{label}</div><strong className="mt-1 block text-lg">{value}</strong></div>)}
    </div>
    <div className="mt-6 flex flex-wrap gap-3">
      <button disabled={!cloud.configured || !online} onClick={() => void sync()} className="rounded-xl bg-[#20221f] px-4 py-2 text-sm text-white disabled:opacity-40">手動同步</button>
      <button disabled={!cloud.configured || !online || downloadPreview.available === 0} onClick={() => void download()} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40">下載雲端資料</button>
      {!cloud.configured && <Link className="rounded-xl border px-4 py-2 text-sm" href="/login">登入雲端帳號</Link>}
      <button onClick={() => { scan(); if (cloud.configured) void loadCloudSnapshot(); }} className="rounded-xl border px-4 py-2 text-sm">重新掃描</button>
    </div>
    {cloud.configured && <p className="mt-3 text-sm text-[#77786f]">可安全下載 {downloadPreview.available} 筆；雲端已有對應本機資料 {downloadPreview.conflicts} 筆；無效資料 {downloadPreview.invalid} 筆。</p>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    <section className="mt-8 rounded-2xl border border-[#ded8cc] bg-[#fffdf9] p-5"><h2 className="font-semibold">Migration Wizard</h2><p className="mt-1 text-sm text-[#77786f]">四個步驟均由你確認；可取消後稍後繼續。</p><div className="mt-4 flex flex-wrap gap-2 text-xs">{["scan", "preview", "choose", "execute"].map((step) => <span key={step} className={`rounded-full px-3 py-1 ${migration?.step === step ? "bg-[#20221f] text-white" : "bg-[#eee9df]"}`}>{step}</span>)}</div><p className="mt-4 text-sm">{migration ? `已處理 ${migration.processed} / ${migration.total}；錯誤 ${migration.errors.length}。` : "按重新掃描建立遷移計畫。"}</p><div className="mt-4 flex flex-wrap gap-2"><button disabled={!migration} onClick={() => advance("preview")} className="rounded-lg border px-3 py-2 text-sm">預覽</button><button disabled={!migration} onClick={() => advance("choose")} className="rounded-lg border px-3 py-2 text-sm">選擇資料</button><button disabled={!migration || !cloud.configured} onClick={() => { advance("execute"); void sync(); }} className="rounded-lg border px-3 py-2 text-sm">開始分批執行</button><button disabled={!migration} onClick={() => { if (migration) { const next = { ...migration, cancelled: true, updatedAt: new Date().toISOString() }; saveMigrationState(next); setMigration(next); } }} className="rounded-lg border px-3 py-2 text-sm">取消並保留進度</button></div></section>
    <section className="mt-6 rounded-2xl border border-[#ded8cc] bg-[#fffdf9] p-5"><h2 className="font-semibold">Conflict Resolution</h2><p className="mt-1 text-sm text-[#77786f]">目前 {status("conflict")} 個衝突。同 ID 的雲端資料不會覆蓋本機，會保留本機並標示衝突；不顯示或傳送原始 JSON。</p></section>
  </section>;
}
