"use client";

import { useEffect, useState } from "react";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const client = getBrowserSupabaseClient();
  const disabled = !client || loading || !ready;

  useEffect(() => {
    let active = true;
    async function verifyRecoverySession() {
      if (!client) {
        if (active) setMessage("雲端帳號尚未啟用；請稍後再試。");
        return;
      }
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error) {
          if (active) setMessage("重設連結無效或已過期，請重新申請。");
          return;
        }
      }
      const { data, error } = await client.auth.getUser();
      if (!data.user || error) {
        if (active) setMessage("重設連結無效或已過期，請重新申請。");
        return;
      }
      window.history.replaceState({}, document.title, "/reset-password");
      if (active) setReady(true);
    }
    void verifyRecoverySession();
    return () => { active = false; };
  }, [client]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !ready) return setMessage("請先使用有效的重設連結。");
    if (password !== confirm) return setMessage("兩次密碼不一致。");
    setLoading(true);
    setMessage("");
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) setMessage("無法更新密碼；請重新申請重設連結或稍後再試。");
      else {
        setMessage("密碼已更新，正在前往帳號頁。");
        window.location.assign("/account");
      }
    } catch {
      setMessage("無法更新密碼；請重新申請重設連結或稍後再試。");
    } finally {
      setLoading(false);
    }
  }

  return <section className="mx-auto max-w-md p-6 md:p-12"><h1 className="font-serif text-3xl">設定新密碼</h1><p className="mt-3 text-sm text-[#77786f]">請設定新密碼以完成帳號復原。</p>{!ready && !message && <p role="status" className="mt-4 text-sm">正在驗證重設連結…</p>}<form className="mt-8 space-y-4" onSubmit={submit}><input aria-label="新密碼" required minLength={8} disabled={!ready} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="新密碼（至少 8 字元）" className="w-full rounded-xl border p-3 disabled:opacity-50" /><input aria-label="確認新密碼" required minLength={8} disabled={!ready} type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="再次輸入新密碼" className="w-full rounded-xl border p-3 disabled:opacity-50" /><button disabled={disabled} className="w-full rounded-xl bg-[#20221f] p-3 text-white disabled:opacity-50">{loading ? "更新中…" : "更新密碼"}</button></form>{message && <p role="status" className="mt-4 text-sm">{message}</p>}</section>;
}
