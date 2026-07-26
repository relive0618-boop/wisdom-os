import { redirect } from "next/navigation";
import { claimsAreAdmin, getVerifiedClaims } from "@/lib/supabase/server";
export default async function AdminPage() { const { claims } = await getVerifiedClaims(); if (!claimsAreAdmin(claims)) redirect("/login?next=/admin"); return <section className="mx-auto max-w-3xl p-6 md:p-12"><p className="text-xs text-[#77786f]">管理后台</p><h1 className="mt-2 font-serif text-3xl">知识与案例审核</h1><p className="mt-4 text-sm text-[#77786f]">管理操作受 Supabase RLS 和 app_metadata.role=admin 保护。公开使用者只能看到已发布内容。</p></section>; }
