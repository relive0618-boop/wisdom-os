"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [theme, setTheme] = useState("light");
  const [stats, setStats] = useState({ cycles: 0, reviews: 0, itemsDone: 0 });
  const [remote, setRemote] = useState({ configured: false, apiKeyConfigured: false, provider: null as string | null, safeBaseUrl: null as string | null, model: null as string | null, timeoutMs: 25000, maxRetries: 1, maxOutputTokens: 1800, responseFormatMode: "prompt" as "prompt" | "json_object", totalBudgetMs: 45000, defaultMode: "auto" });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const t = localStorage.getItem("wisdom_theme") || "light";
      setTheme(t);
      document.documentElement.dataset.theme = t;
      document.documentElement.classList.toggle("dark", t === "dark");

      let cycles = 0, reviews = 0, itemsDone = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("wisdom_pdca_cycle_")) {
          try {
            const c = JSON.parse(localStorage.getItem(key) || "") as { checkins?: unknown[]; items?: Array<{ status?: string }> };
            cycles++;
            reviews += c.checkins?.length || 0;
            itemsDone += c.items?.filter((item) => item.status === "done").length || 0;
          } catch { /* Ignore malformed local records. */ }
        }
      }
      setStats({ cycles, reviews, itemsDone });
    }, 0);
    fetch("/api/health")
      .then((res) => res.json())
      .then((data: { remote?: Partial<typeof remote>; defaultMode?: string }) => setRemote((previous) => ({ ...previous, ...(data.remote || {}), defaultMode: data.defaultMode || previous.defaultMode })))
      .catch(() => undefined);
    return () => window.clearTimeout(timer);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("wisdom_theme", next);
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">Settings</span>
      <h2 className="mt-1 text-2xl font-semibold">设置</h2>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        {/* Engine */}
        <div className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-6">
          <div className="mb-4">
            <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
              Engine
            </span>
            <h3 className="mt-1 text-base font-semibold">智慧引擎</h3>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <b className="text-sm">本地知识引擎</b>
                <p className="mt-0.5 text-[11px] text-[#77786f]">
                  规则检索、三方案分析、零 API 费用
                </p>
              </div>
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-medium text-green-700">
                正在使用
              </span>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <b className="text-sm">远程 AI 接口</b>
                <p className="mt-0.5 text-[11px] text-[#77786f]">
                  通过服务器环境变量配置
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${remote.configured ? "bg-green-100 text-green-700" : "bg-[#eee9df] text-[#77786f]"}`}>
                {remote.configured ? "已配置" : "未配置"}
              </span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {["AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_TIMEOUT_MS", "AI_MAX_RETRIES", "AI_MAX_OUTPUT_TOKENS", "AI_RESPONSE_FORMAT_MODE", "AI_TOTAL_BUDGET_MS"].map((v) => (
              <code key={v} className="rounded-lg bg-[#eee9df] px-2 py-1 text-[10px] text-[#77786f]">
                {v}
              </code>
            ))}
          </div>
          <div className="mt-4 space-y-2 border-t border-[#ded8cc] pt-4 text-xs text-[#77786f]">
            <div>Provider：{remote.provider || "未配置"}</div>
            <div>Base URL：{remote.safeBaseUrl || "未配置"}</div>
            <div>Model：{remote.model || "未配置"}</div>
            <div>Timeout：{remote.timeoutMs / 1000} 秒</div>
            <div>Max retries：{remote.maxRetries}</div>
            <div>Max output tokens：{remote.maxOutputTokens}</div>
            <div>JSON mode：{remote.responseFormatMode}</div>
            <div>Total budget：{remote.totalBudgetMs / 1000} 秒</div>
            <div>API Key：{remote.apiKeyConfigured ? "已設定" : "未設定"}</div>
            <div>默认分析模式：{remote.defaultMode}</div>
          </div>
        </div>

        {/* Privacy */}
        <div className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-6">
          <div className="mb-4">
            <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
              Privacy
            </span>
            <h3 className="mt-1 text-base font-semibold">隐私与数据</h3>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <b className="text-sm">决策记录</b>
                <p className="mt-0.5 text-[11px] text-[#77786f]">
                  保存在浏览器本地存储
                </p>
              </div>
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-medium text-green-700">
                  本机持久化
              </span>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <b className="text-sm">使用统计</b>
                <p className="mt-0.5 text-[11px] text-[#77786f]">所有数据仅在你本机</p>
              </div>
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-medium text-green-700">
                安全
              </span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-6">
          <div className="mb-4">
            <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
              Usage
            </span>
            <h3 className="mt-1 text-base font-semibold">使用统计</h3>
          </div>

          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-[#8a4d2e]">{stats.cycles}</div>
              <div className="mt-1 text-[10px] text-[#77786f]">决策记录</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[#8a4d2e]">{stats.itemsDone}</div>
              <div className="mt-1 text-[10px] text-[#77786f]">已完成事项</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[#8a4d2e]">{stats.reviews}</div>
              <div className="mt-1 text-[10px] text-[#77786f]">复盘记录</div>
            </div>
          </div>
        </div>

        {/* Theme */}
        <div className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-6">
          <div className="mb-4">
            <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
              Appearance
            </span>
            <h3 className="mt-1 text-base font-semibold">外观</h3>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <b className="text-sm">主题模式</b>
              <p className="mt-0.5 text-[11px] text-[#77786f]">
                当前：{theme === "dark" ? "深色模式" : "浅色模式"}
              </p>
            </div>
            <button
              onClick={toggleTheme}
              className="rounded-xl border border-[#ded8cc] px-4 py-2 text-sm font-medium hover:bg-[#f4f1ea]"
            >
              {theme === "dark" ? "☀️ 切换浅色" : "🌙 切换深色"}
            </button>
          </div>
        </div>
      </div>

      <p className="mt-8 text-center text-[11px] text-[#77786f]">
        AI Wisdom OS v0.2 · 报告与 PDCA 保存在本机浏览器中
      </p>
    </div>
  );
}
