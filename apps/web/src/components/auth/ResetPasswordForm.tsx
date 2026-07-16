"use client";

import { useState } from "react";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const client = getBrowserSupabaseClient();
  const disabled = !client || loading;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return setMessage("雲端帳號尚未啟用；請稍後再試。");
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

  return <section className="mx-auto max-w-md p-6 md:p-12"><h1 className="font-serif text-3xl">設定新密碼</h1><p className="mt-3 text-sm text-[#77786f]">請設定新密碼以完成帳號復原。</p><form className="mt-8 space-y-4" onSubmit={submit}><input aria-label="新密碼" required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="新密碼（至少 8 字元）" className="w-full rounded-xl border p-3" /><input aria-label="確認新密碼" required minLength={8} type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="再次輸入新密碼" className="w-full rounded-xl border p-3" /><button disabled={disabled} className="w-full rounded-xl bg-[#20221f] p-3 text-white disabled:opacity-50">{loading ? "更新中…" : "更新密碼"}</button></form>{message && <p role="status" className="mt-4 text-sm">{message}</p>}</section>;
}
