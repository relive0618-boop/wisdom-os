"use client";

import Link from "next/link";
import { useState } from "react";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";

export function AuthForm({ mode }: { mode: "login" | "signup" | "forgot" }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(false);
  const client = getBrowserSupabaseClient();
  const disabled = !client || loading;
  async function run(action: "password" | "magic") {
    if (!client) return setMessage("雲端帳號尚未啟用；本地決策與歷史功能仍可使用。");
    if (mode === "signup" && password !== confirm) return setMessage("兩次密碼不一致。");
    setLoading(true); setMessage(""); const redirectTo = `${window.location.origin}/auth/callback${mode === "forgot" ? "?next=%2Freset-password" : ""}`;
    try {
      const result = action === "magic" ? await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } }) : mode === "login" ? await client.auth.signInWithPassword({ email, password }) : mode === "signup" ? await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }) : await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (result.error) setMessage("無法完成帳號操作，請檢查資料、驗證信或稍後重試。");
      else if (action === "magic") setMessage("登入連結已寄出，請查看信箱。");
      else if (mode === "forgot") setMessage("重設信已寄出；連結過期時請重新申請。");
      else if (mode === "signup") setMessage("註冊完成，請查看驗證信。");
      else window.location.assign("/account");
    } catch { setMessage("無法完成帳號操作，請稍後重試。"); } finally { setLoading(false); }
  }
  const title = mode === "login" ? "登入雲端帳號" : mode === "signup" ? "建立雲端帳號" : "重設密碼";
  return <section className="mx-auto max-w-md p-6 md:p-12"><h1 className="font-serif text-3xl">{title}</h1><p className="mt-3 text-sm text-[#77786f]">雲端同步為選用功能；未啟用時，資料仍只保存在你的裝置。</p><form className="mt-8 space-y-4" onSubmit={(event) => { event.preventDefault(); void run("password"); }}><input aria-label="電子信箱" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="電子信箱" className="w-full rounded-xl border p-3" />{mode !== "forgot" && <><input aria-label="密碼" required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密碼（至少 8 字元）" className="w-full rounded-xl border p-3" />{mode === "signup" && <input aria-label="確認密碼" required minLength={8} type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="確認密碼" className="w-full rounded-xl border p-3" />}</>}<button disabled={disabled} className="w-full rounded-xl bg-[#20221f] p-3 text-white disabled:opacity-50">{loading ? "處理中…" : mode === "login" ? "登入" : mode === "signup" ? "建立帳號" : "寄送重設信"}</button></form>{mode === "login" && <button disabled={disabled || !email} onClick={() => void run("magic")} className="mt-3 w-full rounded-xl border p-3 text-sm disabled:opacity-50">使用 Magic Link 登入</button>}{message && <p role="status" className="mt-4 text-sm">{message}</p>}<p className="mt-6 text-sm"><Link href={mode === "login" ? "/signup" : "/login"} className="underline">{mode === "login" ? "建立帳號" : "回到登入"}</Link>{mode !== "forgot" && <>　<Link href="/forgot-password" className="underline">忘記密碼</Link></>}</p></section>;
}
