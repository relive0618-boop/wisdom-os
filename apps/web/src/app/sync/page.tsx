"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnalyzeResponseSchema, PdcaCycleSchema, type PdcaCycle } from "@wisdom/shared";
import {
  beginCloudRequest,
  browserConnectionChanged,
  cloudConnectionLabel,
  finishCloudRequest,
  initialCloudConnectionState,
  type CloudConnectionState,
} from "@/lib/cloud/connectionState";
import { createNewCycle, generateInitialItems, listCycles, replaceCycle, restoreCycle, saveCycle } from "@/lib/pdca";
import { listReports, replaceReport, restoreReport, saveReport } from "@/lib/reportStore";
import {
  createMigrationState,
  getOrCreateDeviceId,
  loadMigrationState,
  metadataEntityId,
  parseCloudSnapshot,
  planCloudSync,
  saveMigrationState,
  syncPayloadHash,
  syncPush,
  syncRepository,
  type CloudSnapshot,
  type MigrationState,
  type PlannedSyncItem,
  type SyncPushResult,
} from "@/lib/cloud/sync";

type CloudInfo = { configured: boolean; authEnabled: boolean; syncEnabled: boolean };
type LocalEntity = { entityType: "report" | "pdca"; entityId: string; payload: unknown; updatedAt: string };
const emptyCloud: CloudInfo = { configured: false, authEnabled: false, syncEnabled: false };
const emptyCounts = { reports: 0, cycles: 0, cloudReports: 0, cloudCycles: 0 };
const BACKUP_KEY = "wisdom_cloud_sync_backups_v1";

function localEntities(): LocalEntity[] {
  return [
    ...listReports().map((item) => ({ entityType: "report" as const, entityId: item.reportId, payload: item, updatedAt: item.createdAt })),
    ...listCycles().map((item) => ({ entityType: "pdca" as const, entityId: item.cycleId, payload: item, updatedAt: item.startedAt })),
  ];
}

function safeBackup(entity: LocalEntity) {
  try {
    const existing = JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]");
    const values = Array.isArray(existing) ? existing : [];
    localStorage.setItem(BACKUP_KEY, JSON.stringify([...values, { ...entity, backedUpAt: new Date().toISOString() }]));
    return true;
  } catch { return false; }
}

function labelFor(item: PlannedSyncItem, index: number) {
  return `${item.entityType === "report" ? "報告" : "PDCA"} ${index + 1}`;
}

export default function SyncPage() {
  const [cloud, setCloud] = useState(emptyCloud);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<CloudConnectionState>(initialCloudConnectionState);
  const [counts, setCounts] = useState(emptyCounts);
  const [plan, setPlan] = useState<PlannedSyncItem[]>([]);
  const [snapshot, setSnapshot] = useState<CloudSnapshot | null>(null);
  const [migration, setMigration] = useState<MigrationState | null>(null);
  const [message, setMessage] = useState("");
  const mountedRef = useRef(false);
  const cancelRef = useRef(false);
  const connectionRef = useRef(initialCloudConnectionState());

  const publishConnection = useCallback((next: CloudConnectionState) => {
    connectionRef.current = next;
    if (mountedRef.current) setConnection(next);
  }, []);
  const browserIsOnline = useCallback(() => typeof navigator === "undefined" || navigator.onLine, []);
  const runCloudRequest = useCallback(async <T,>(request: () => Promise<T>) => {
    const started = beginCloudRequest(connectionRef.current, browserIsOnline());
    publishConnection(started.state);
    if (!started.shouldRequest) throw new Error("CLOUD_OFFLINE");
    try {
      const result = await request();
      publishConnection(finishCloudRequest(connectionRef.current, started.requestId, browserIsOnline(), true));
      return result;
    } catch (error) {
      publishConnection(finishCloudRequest(connectionRef.current, started.requestId, browserIsOnline(), false));
      throw error;
    }
  }, [browserIsOnline, publishConnection]);

  const saveMigration = useCallback((next: MigrationState) => {
    saveMigrationState(next);
    if (mountedRef.current) setMigration(next);
  }, []);

  const scanLocal = useCallback(() => {
    const local = localEntities();
    const nextMetadata = syncRepository.listMetadata();
    if (!mountedRef.current) return { local, nextMetadata };
    setCounts((previous) => ({ ...previous, reports: local.filter((item) => item.entityType === "report").length, cycles: local.filter((item) => item.entityType === "pdca").length }));
    const saved = loadMigrationState();
    // An empty selection is intentional: never silently re-select data a user
    // has explicitly excluded from the migration.
    const selectedIds = Array.isArray(saved?.selectedIds) ? saved.selectedIds : local.map((item) => metadataEntityId(item.entityType, item.entityId));
    setMigration(saved ?? { ...createMigrationState(local.length), selectedIds });
    return { local, nextMetadata };
  }, []);

  const applySnapshot = useCallback(async (nextSnapshot: CloudSnapshot, nextMetadata = syncRepository.listMetadata()) => {
    const nextPlan = await planCloudSync(localEntities(), nextSnapshot, nextMetadata);
    if (!mountedRef.current) return nextPlan;
    setSnapshot(nextSnapshot);
    setCounts((previous) => ({ ...previous, cloudReports: nextSnapshot.reports.length, cloudCycles: nextSnapshot.cycles.length }));
    setPlan(nextPlan);
    return nextPlan;
  }, []);

  const loadCloudSnapshot = useCallback(async () => {
    const body = await runCloudRequest(async () => {
      const response = await fetch("/api/cloud/sync/pull", { method: "POST" });
      if (!response.ok) throw new Error("CLOUD_PULL_FAILED");
      return response.json().catch(() => null);
    });
    return applySnapshot(parseCloudSnapshot(body));
  }, [applySnapshot, runCloudRequest]);

  const refreshCloud = useCallback(async () => {
    const data = await runCloudRequest(async () => {
      const response = await fetch("/api/health");
      if (!response.ok) throw new Error("CLOUD_HEALTH_FAILED");
      return response.json().catch(() => null) as Promise<{ cloud?: CloudInfo } | null>;
    });
    const next = data?.cloud ?? emptyCloud;
    if (mountedRef.current) setCloud(next);
    return next.configured ? loadCloudSnapshot() : [];
  }, [loadCloudSnapshot, runCloudRequest]);

  useEffect(() => {
    mountedRef.current = true;
    scanLocal();
    void refreshCloud().catch(() => undefined).finally(() => { if (mountedRef.current) setLoading(false); });
    const offline = () => publishConnection(browserConnectionChanged(connectionRef.current, false));
    const online = () => publishConnection(browserConnectionChanged(connectionRef.current, true));
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => { mountedRef.current = false; window.removeEventListener("offline", offline); window.removeEventListener("online", online); };
  }, [publishConnection, refreshCloud, scanLocal]);

  const persistBatch = useCallback(async (results: SyncPushResult[], total: number) => {
    const now = new Date().toISOString();
    for (const result of results) {
      syncRepository.saveMetadata({
        entityId: metadataEntityId(result.entityType, result.entityId),
        localUpdatedAt: result.updatedAt ?? now,
        cloudRevision: result.cloudRevision,
        lastSyncedHash: result.success ? result.hash : null,
        lastSyncedAt: result.success ? now : null,
        syncState: result.success ? "synced" : result.errorCode === "CLOUD_CONFLICT" ? "conflict" : "error",
        source: result.success ? "both" : "local",
        pendingOperation: result.success ? "none" : result.operation === "upload_create" ? "create" : "update",
      });
    }
    const current = loadMigrationState();
    if (current) saveMigration({ ...current, processed: Math.min(total, current.processed + results.filter((item) => item.success).length), errors: [...current.errors, ...results.filter((item) => !item.success).map((item) => item.errorCode ?? "CLOUD_TEMPORARILY_UNAVAILABLE")], updatedAt: now });
  }, [saveMigration]);

  const applyDownloads = useCallback(async (items: PlannedSyncItem[]) => {
    let restored = 0;
    let failed = 0;
    const now = new Date().toISOString();
    for (const item of items) {
      if (!item.cloud) continue;
      if (item.operation === "download_update" && item.local && !safeBackup({ entityType: item.entityType, entityId: item.entityId, ...item.local })) { failed += 1; continue; }
      if (item.entityType === "report") {
        const cloudReport = item.cloud as Extract<CloudSnapshot["reports"][number], { reportId: string }>;
        const result = item.operation === "download_create"
          ? restoreReport(cloudReport.payload, cloudReport.clientUpdatedAt ?? cloudReport.updatedAt)
          : replaceReport(cloudReport.payload, cloudReport.clientUpdatedAt ?? cloudReport.updatedAt);
        if (!result.ok) { failed += 1; continue; }
      } else {
        const cloudCycle = item.cloud as Extract<CloudSnapshot["cycles"][number], { cycleId: string }>;
        const result = item.operation === "download_create" ? restoreCycle(cloudCycle.payload) : replaceCycle(cloudCycle.payload);
        if (!result.ok) { failed += 1; continue; }
      }
      syncRepository.saveMetadata({
        entityId: metadataEntityId(item.entityType, item.entityId), localUpdatedAt: item.entityType === "report" ? (item.cloud as CloudSnapshot["reports"][number]).clientUpdatedAt ?? (item.cloud as CloudSnapshot["reports"][number]).updatedAt : (item.cloud as CloudSnapshot["cycles"][number]).payload.startedAt,
        cloudRevision: item.cloud.revision, lastSyncedHash: await syncPayloadHash(item.entityType, item.cloud.payload), lastSyncedAt: now,
        syncState: "synced", source: "both", pendingOperation: "none",
      });
      restored += 1;
    }
    return { restored, failed };
  }, []);

  const executeUpload = useCallback(async (items: PlannedSyncItem[], wizard = false) => {
    const upload = items.filter((item) => item.operation === "upload_create" || item.operation === "upload_update");
    if (!upload.length) return { success: 0, failed: 0 };
    const entities = upload.map((item) => ({ entityType: item.entityType, entityId: item.entityId, payload: item.local?.payload, revision: item.operation === "upload_update" ? item.expectedRevision : null, updatedAt: item.local?.updatedAt ?? null, deletedAt: null, deviceId: getOrCreateDeviceId() }));
    const results = await runCloudRequest(() => syncPush(getOrCreateDeviceId(), entities, fetch, {
      shouldCancel: () => wizard && cancelRef.current,
      onBatch: (batch) => persistBatch(batch, upload.length),
    }));
    return { success: results.filter((item) => item.success).length, failed: results.filter((item) => !item.success).length };
  }, [persistBatch, runCloudRequest]);

  const manualSync = useCallback(async () => {
    if (!cloud.configured || connection.status !== "connected") return;
    setMessage("正在依同步計畫處理資料…");
    try {
      const activePlan = await loadCloudSnapshot();
      const downloads = await applyDownloads(activePlan.filter((item) => item.operation === "download_create" || item.operation === "download_update"));
      const uploaded = await executeUpload(activePlan);
      scanLocal();
      await loadCloudSnapshot();
      if (mountedRef.current) setMessage(`已安全同步 ${downloads.restored + uploaded.success} 筆資料；${downloads.failed + uploaded.failed} 筆待稍後處理。`);
    } catch { if (mountedRef.current) setMessage("同步暫時無法完成；本機資料未受影響，可稍後重試。"); }
  }, [applyDownloads, cloud.configured, connection.status, executeUpload, loadCloudSnapshot, scanLocal]);

  const download = useCallback(async () => {
    if (!cloud.configured || connection.status !== "connected") return;
    setMessage("正在檢查並還原雲端資料…");
    try {
      const activePlan = await loadCloudSnapshot();
      const restored = await applyDownloads(activePlan.filter((item) => item.operation === "download_create"));
      scanLocal();
      await loadCloudSnapshot();
      if (mountedRef.current) setMessage(restored.failed ? `已還原 ${restored.restored} 筆；${restored.failed} 筆未還原。` : `已還原 ${restored.restored} 筆資料。`);
    } catch { if (mountedRef.current) setMessage("還原暫時無法完成；本機資料未受影響，可稍後重試。"); }
  }, [applyDownloads, cloud.configured, connection.status, loadCloudSnapshot, scanLocal]);

  const updateMigration = useCallback((patch: Partial<MigrationState>) => {
    if (!migration) return;
    saveMigration({ ...migration, ...patch, updatedAt: new Date().toISOString() });
  }, [migration, saveMigration]);

  const runWizard = useCallback(async () => {
    if (!migration || !cloud.configured || migration.cancelled) return;
    const activePlan = await loadCloudSnapshot();
    const selected = new Set(migration.selectedIds);
    const candidates = activePlan.filter((item) => (item.operation === "upload_create" || item.operation === "upload_update") && selected.has(metadataEntityId(item.entityType, item.entityId)));
    cancelRef.current = false;
    updateMigration({ step: "execute", processed: 0, total: candidates.length, errors: [], cancelled: false });
    const result = await executeUpload(candidates, true);
    scanLocal();
    await loadCloudSnapshot();
    if (mountedRef.current) setMessage(cancelRef.current ? "已在安全批次邊界取消；成功項目已保存進度。" : `遷移完成：${result.success} 筆成功，${result.failed} 筆待重試。`);
  }, [cloud.configured, executeUpload, loadCloudSnapshot, migration, scanLocal, updateMigration]);

  const duplicateBundle = useCallback((item: PlannedSyncItem) => {
    const reportId = item.entityType === "report" ? item.entityId : (item.local?.payload as PdcaCycle)?.reportId;
    const sourceReport = listReports().find((report) => report.reportId === reportId);
    if (!sourceReport) return false;
    const relatedCycles = listCycles().filter((cycle) => cycle.reportId === reportId);
    const nextReportId = crypto.randomUUID();
    const nextCycleId = crypto.randomUUID();
    const copied = AnalyzeResponseSchema.safeParse({ ...sourceReport, reportId: nextReportId, cycleId: nextCycleId, report: { ...sourceReport.report, reportId: nextReportId } });
    if (!copied.success) return false;
    saveReport(copied.data);
    const cyclesToCopy: PdcaCycle[] = relatedCycles.length ? relatedCycles : [createNewCycle(nextReportId, copied.data.decisionId, copied.data.report.problem_summary.slice(0, 40), copied.data.report.category, generateInitialItems(copied.data.report), 1, nextCycleId)];
    for (const [index, cycle] of cyclesToCopy.entries()) {
      const cycleId = index === 0 ? nextCycleId : crypto.randomUUID();
      const clone = PdcaCycleSchema.safeParse({ ...cycle, id: cycleId, cycleId, reportId: nextReportId, decisionId: copied.data.decisionId, legacyKey: undefined });
      if (!clone.success || !saveCycle(clone.data).ok) return false;
      syncRepository.saveMetadata({ entityId: metadataEntityId("pdca", cycleId), localUpdatedAt: clone.data.startedAt, cloudRevision: null, lastSyncedHash: null, lastSyncedAt: null, syncState: "pending_upload", source: "local", pendingOperation: "create", duplicatedFrom: cycle.cycleId });
    }
    syncRepository.saveMetadata({ entityId: metadataEntityId("report", nextReportId), localUpdatedAt: new Date().toISOString(), cloudRevision: null, lastSyncedHash: null, lastSyncedAt: null, syncState: "pending_upload", source: "local", pendingOperation: "create", duplicatedFrom: reportId });
    return true;
  }, []);

  const resolveConflict = useCallback(async (item: PlannedSyncItem, strategy: "local" | "cloud" | "both" | "later") => {
    if (strategy === "later") { setMessage("衝突已保留，稍後再決定。 "); return; }
    if (strategy === "cloud") {
      if (!item.local || !item.cloud || !window.confirm("確認保留雲端版本？本機版本會先安全備份。")) return;
      const result = await applyDownloads([{ ...item, operation: "download_update" }]);
      setMessage(result.failed ? "無法安全替換本機資料；原本資料仍保留。" : "已保留雲端版本；本機原版本已備份。");
    } else if (strategy === "both") {
      if (!window.confirm("確認保留兩個版本？會建立新的本機複本，原始資料不會刪除。")) return;
      setMessage(duplicateBundle(item) ? "已建立新的本機複本，將在下次同步時以新 ID 上傳。" : "無法建立安全複本；原始資料仍保留。");
    } else {
      const result = await executeUpload([{ ...item, operation: "upload_update" }]);
      setMessage(result.failed ? "雲端版本已變更，衝突仍保留。" : "已保留本機版本並安全更新雲端。");
    }
    scanLocal();
    await loadCloudSnapshot();
  }, [applyDownloads, duplicateBundle, executeUpload, loadCloudSnapshot, scanLocal]);

  if (loading) return <section className="mx-auto max-w-4xl p-6 md:p-12">正在讀取同步狀態…</section>;
  const downloadable = plan.filter((item) => item.operation === "download_create").length;
  const conflicts = plan.filter((item) => item.operation === "conflict");
  const uploadable = plan.filter((item) => item.operation === "upload_create" || item.operation === "upload_update");

  return <section className="mx-auto max-w-4xl p-6 md:p-12">
    <p className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">Cloud sync</p>
    <h1 className="mt-2 font-serif text-3xl">同步與遷移</h1>
    <p className="mt-3 text-sm text-[#77786f]">本機資料始終優先。登入不會自動上傳、下載或刪除現有歷史資料。</p>
    <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[["雲端", cloud.configured ? "已配置" : "未配置"], ["網路", cloudConnectionLabel(connection.status)], ["本機報告", String(counts.reports)], ["本機 PDCA", String(counts.cycles)], ["雲端報告", String(counts.cloudReports)], ["雲端 PDCA", String(counts.cloudCycles)], ["待上傳", String(uploadable.length)], ["真正衝突", String(conflicts.length)]].map(([label, value]) => <div key={label} className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-4"><div className="text-xs text-[#77786f]">{label}</div><strong className="mt-1 block text-lg">{value}</strong></div>)}
    </div>
    <div className="mt-6 flex flex-wrap gap-3">
      <button disabled={!cloud.configured || connection.status !== "connected"} onClick={() => void manualSync()} className="rounded-xl bg-[#20221f] px-4 py-2 text-sm text-white disabled:opacity-40">手動同步</button>
      <button disabled={!cloud.configured || connection.status !== "connected" || downloadable === 0} onClick={() => void download()} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40">下載雲端資料</button>
      {!cloud.configured && <Link className="rounded-xl border px-4 py-2 text-sm" href="/login">登入雲端帳號</Link>}
      <button onClick={() => { scanLocal(); void refreshCloud().catch(() => undefined); }} className="rounded-xl border px-4 py-2 text-sm">重新掃描</button>
    </div>
    {cloud.configured && <p className="mt-3 text-sm text-[#77786f]">可安全下載 {downloadable} 筆；已有對應本機資料 {plan.filter((item) => item.operation === "noop").length} 筆；無效資料 {snapshot ? snapshot.invalidReports + snapshot.invalidCycles : 0} 筆。</p>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}

    <section className="mt-8 rounded-2xl border border-[#ded8cc] bg-[#fffdf9] p-5"><h2 className="font-semibold">Migration Wizard</h2><p className="mt-1 text-sm text-[#77786f]">掃描、預覽、選擇與執行均由你確認；取消會在目前批次結束後停止。</p>
      <div className="mt-4 flex flex-wrap gap-2 text-xs">{["scan", "preview", "choose", "execute"].map((step) => <span key={step} className={`rounded-full px-3 py-1 ${migration?.step === step ? "bg-[#20221f] text-white" : "bg-[#eee9df]"}`}>{step}</span>)}</div>
      <p className="mt-4 text-sm">{migration ? `已處理 ${migration.processed} / ${migration.total}；錯誤 ${migration.errors.length}。` : "按重新掃描建立遷移計畫。"}</p>
      <div className="mt-4 flex flex-wrap gap-2"><button disabled={!migration} onClick={() => updateMigration({ step: "preview" })} className="rounded-lg border px-3 py-2 text-sm">預覽</button><button disabled={!migration} onClick={() => updateMigration({ step: "choose" })} className="rounded-lg border px-3 py-2 text-sm">選擇資料</button><button disabled={!migration || !cloud.configured || migration.selectedIds.length === 0} onClick={() => void runWizard()} className="rounded-lg border px-3 py-2 text-sm">開始分批執行</button><button disabled={!migration} onClick={() => { cancelRef.current = true; updateMigration({ cancelled: true }); }} className="rounded-lg border px-3 py-2 text-sm">取消並保留進度</button></div>
      {migration?.step === "choose" && <div className="mt-4 space-y-2">{uploadable.map((item, index) => { const id = metadataEntityId(item.entityType, item.entityId); const selected = migration.selectedIds.includes(id); return <label key={id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected} onChange={() => updateMigration({ selectedIds: selected ? migration.selectedIds.filter((value) => value !== id) : [...migration.selectedIds, id] })} />{labelFor(item, index)}（{item.operation === "upload_create" ? "新增" : "更新"}）</label>; })}{uploadable.length === 0 && <p className="text-sm text-[#77786f]">目前沒有需要上傳的項目。</p>}</div>}
    </section>

    <section className="mt-6 rounded-2xl border border-[#ded8cc] bg-[#fffdf9] p-5"><h2 className="font-semibold">Conflict Resolution</h2><p className="mt-1 text-sm text-[#77786f]">真正衝突不會靜默覆寫。保留雲端前會先備份本機；保留兩者會建立新 ID 的本機複本。</p>
      {conflicts.length === 0 ? <p className="mt-3 text-sm text-[#77786f]">目前沒有真正衝突。</p> : <div className="mt-4 space-y-3">{conflicts.map((item, index) => <div key={metadataEntityId(item.entityType, item.entityId)} className="rounded-lg border p-3"><p className="text-sm font-medium">{labelFor(item, index)}需要決定</p><div className="mt-2 flex flex-wrap gap-2"><button onClick={() => void resolveConflict(item, "local")} className="rounded border px-3 py-1 text-sm">保留本機</button><button onClick={() => void resolveConflict(item, "cloud")} className="rounded border px-3 py-1 text-sm">保留雲端</button><button onClick={() => void resolveConflict(item, "both")} className="rounded border px-3 py-1 text-sm">兩者保留</button><button onClick={() => void resolveConflict(item, "later")} className="rounded border px-3 py-1 text-sm">稍後決定</button></div></div>)}</div>}
    </section>
  </section>;
}
