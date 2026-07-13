"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveReport } from "@/lib/reportStore";

const STEPS = [
  { key: "situation", label: "描述处境", icon: "1" },
  { key: "details", label: "补充详情", icon: "2" },
  { key: "stakes", label: "盘点筹码", icon: "3" },
];

const TEMPLATES = [
  {
    title: "职业转型",
    question: "我正在考虑离职创业，但担心收入不稳定。",
    background: "目前工作稳定但发展空间有限，有想做的方向但不确定时机是否成熟。",
    goal: "找到低风险的转型路径",
    constraints: "需要维持基本收入，不能承受超过三个月的收入中断",
    risks: "新方向可能没有想象中好，回不去原行业的风险",
    category: "职场",
  },
  {
    title: "商业竞争",
    question: "竞争对手突然降价，我应该跟进价格战吗？",
    background: "主要对手降价30%，客户开始询问能否匹配价格。",
    goal: "维持市场份额同时不破坏利润",
    constraints: "品牌定位在中高端，降价可能伤害品牌形象",
    resources: "现金流充足，可以承受短期利润下降",
    risks: "不跟进会丢失客户，跟进会陷入长期消耗",
    category: "创业",
  },
  {
    title: "谈判压价",
    question: "客户一直压价，我要如何改变谈判局势？",
    background: "客户认为我们的方案和竞品差不多，只愿意接受最低价。",
    goal: "以合理的价格成交，维持利润空间",
    constraints: "对方有多个备选供应商，我们不是唯一选择",
    resources: "交付质量和服务响应速度有优势",
    risks: "坚持价格可能丢单，降价太多没有利润",
    category: "谈判",
  },
  {
    title: "团队冲突",
    question: "团队内部两个部门冲突，我应该如何协调？",
    background: "A部门和B部门争夺同一研发资源，互相指责对方拖延项目。",
    goal: "让两个部门恢复正常协作",
    constraints: "研发资源短期内无法增加，两个项目都很重要",
    risks: "处理不当会导致核心成员离职",
    category: "管理",
  },
];

const CATEGORIES = [
  { value: "自动判断", note: "由 AI 自动归类" },
  { value: "创业", note: "商业决策、产品、市场、增长" },
  { value: "职场", note: "职业选择、办公室关系、升职" },
  { value: "谈判", note: "价格、合同、利益协调" },
  { value: "管理", note: "团队、组织、制度、执行" },
  { value: "学习", note: "技能提升、考试、训练计划" },
  { value: "人际", note: "朋友、家庭、伴侣、沟通" },
  { value: "投资", note: "资产配置、风险、收益评估" },
];

export default function DecisionPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: "",
    question: "",
    category: "自动判断",
    deadline: "",
    background: "",
    goal: "",
    resources: "",
    constraints: "",
    risks: "",
  });

  function update(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function applyTemplate(t: (typeof TEMPLATES)[0]) {
    setForm((prev) => ({
      ...prev,
      title: t.title,
      question: t.question,
      background: t.background,
      goal: t.goal,
      constraints: t.constraints,
      risks: t.risks,
      category: t.category,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || data?.error || "分析失败");
      const saved = saveReport(data);
      router.push(`/report?reportId=${encodeURIComponent(saved.reportId)}`);
    } catch {
      alert("分析失败，请重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 pb-24 sm:p-8 sm:pb-8">
      {/* Quick templates */}
      <div className="mb-8">
        <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
          Quick Start
        </span>
        <h2 className="mt-1 text-xl font-semibold">你现在面对什么局势？</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TEMPLATES.map((t) => (
            <button
              key={t.title}
              onClick={() => {
                applyTemplate(t);
                setStep(2);
              }}
              className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] px-4 py-4 text-left text-sm hover:border-[#8a4d2e] hover:shadow-sm"
            >
              <b className="block text-sm">{t.title}</b>
              <span className="mt-1 block text-xs leading-relaxed text-[#77786f]">
                {t.question.slice(0, 36)}...
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Step indicator */}
      <div className="mb-6 flex items-center gap-3">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <span
              className={`grid h-7 w-7 place-items-center rounded-lg text-xs font-bold ${
                i === step
                  ? "bg-[#8a4d2e] text-white"
                  : i < step
                    ? "bg-[#486451] text-white"
                    : "bg-[#eee9df] text-[#77786f]"
              }`}
            >
              {i < step ? "✓" : s.icon}
            </span>
            <span
              className={`text-xs font-medium ${
                i === step ? "text-[#20221f]" : "text-[#77786f]"
              }`}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-1 h-px w-8 ${
                  i < step ? "bg-[#486451]" : "bg-[#ded8cc]"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        <div className="rounded-xl border border-[#ded8cc] bg-[#fffdf9] p-8">
          {/* Step 0: Situation */}
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
                  Step 1 / 3
                </span>
                <h2 className="mt-1 text-xl font-semibold">先说说发生了什么事</h2>
                <p className="mt-1 text-sm text-[#77786f]">
                  一句话说清楚，越具体越好。
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-5">
                <div className="sm:col-span-3">
                  <DecisionField
                    label="问题标题"
                    hint="用一句话总结你的处境"
                    value={form.title}
                    onChange={(v) => update("title", v)}
                    placeholder="例如：现在适合离职创业吗？"
                    maxLength={80}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-[#555]">
                      问题类别
                    </span>
                    <select
                      value={form.category}
                      onChange={(e) => update("category", e.target.value)}
                      className="w-full rounded-xl border border-[#ded8cc] bg-[#f4f1ea] px-4 py-3 text-sm outline-none focus:border-[#8a4d2e] focus:ring-2 focus:ring-[#8a4d2e]/10"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.value}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-[#77786f]">
                      {CATEGORIES.find((c) => c.value === form.category)?.note}
                    </p>
                  </label>
                </div>
              </div>

              <DecisionField
                label="你真正想解决的问题"
                hint="把事情经过、犹豫的原因、为什么是现在写清楚"
                value={form.question}
                onChange={(v) => update("question", v)}
                placeholder="描述事情经过、你目前的犹豫，以及为什么现在需要决定。"
                textarea
                rows={4}
                required
              />
            </div>
          )}

          {/* Step 1: Details */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
                  Step 2 / 3
                </span>
                <h2 className="mt-1 text-xl font-semibold">补充背景与目标</h2>
                <p className="mt-1 text-sm text-[#77786f]">
                  你拥有什么条件？想达成什么结果？什么时候必须决定？
                </p>
              </div>

              <DecisionField
                label="当前背景"
                hint="你拥有哪些筹码？事情走到哪一步了？"
                value={form.background}
                onChange={(v) => update("background", v)}
                placeholder="你拥有哪些条件？事情目前发展到哪一步？"
                textarea
                rows={3}
              />

              <div className="grid gap-5 sm:grid-cols-2">
                <DecisionField
                  label="期望目标"
                  hint="你希望最终得到什么？"
                  value={form.goal}
                  onChange={(v) => update("goal", v)}
                  placeholder="你希望最终得到什么结果？"
                />
                <label className="block">
                  <span className="mb-1.5 block text-xs font-bold text-[#555]">
                    决策期限
                    <span className="ml-1 font-normal text-[#77786f]">
                      （可选）
                    </span>
                  </span>
                  <input
                    type="date"
                    value={form.deadline}
                    onChange={(e) => update("deadline", e.target.value)}
                    className="w-full rounded-xl border border-[#ded8cc] bg-[#f4f1ea] px-4 py-3 text-sm outline-none focus:border-[#8a4d2e] focus:ring-2 focus:ring-[#8a4d2e]/10"
                  />
                  <p className="mt-1 text-[11px] text-[#77786f]">何时必须做出决定</p>
                </label>
              </div>
            </div>
          )}

          {/* Step 2: Stakes */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-[#8a4d2e]">
                  Step 3 / 3
                </span>
                <h2 className="mt-1 text-xl font-semibold">盘点手中的筹码</h2>
                <p className="mt-1 text-sm text-[#77786f]">
                  有什么资源可以调用？有什么限制和风险不能忽视？
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <DecisionField
                  label="现有资源"
                  hint="资金、时间、人脉、能力、信息"
                  value={form.resources}
                  onChange={(v) => update("resources", v)}
                  placeholder="资金、时间、人脉、能力、信息"
                  textarea
                  rows={3}
                />
                <DecisionField
                  label="主要限制"
                  hint="预算、时间、责任、关系、规则"
                  value={form.constraints}
                  onChange={(v) => update("constraints", v)}
                  placeholder="预算、时间、责任、关系、规则"
                  textarea
                  rows={3}
                />
              </div>

              <DecisionField
                label="最担心的风险"
                hint="最坏的情况是什么？你能承受吗？"
                value={form.risks}
                onChange={(v) => update("risks", v)}
                placeholder="失败后最严重的后果是什么？"
                textarea
                rows={3}
              />
            </div>
          )}

          {/* Footer */}
          <div className="mt-8 flex items-center justify-between border-t border-[#ded8cc] pt-5">
            <div>
              {step > 0 ? (
                <button
                  type="button"
                  onClick={() => setStep(step - 1)}
                  className="rounded-xl border border-[#ded8cc] px-5 py-2.5 text-sm font-medium hover:bg-[#f4f1ea]"
                >
                  上一步
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-3">
              {/* Fill indicator */}
              <div className="hidden items-center gap-2 sm:flex">
                {(["title", "question"] as const).map((k) => (
                  <div
                    key={k}
                    className={`h-1.5 w-1.5 rounded-full ${
                      form[k] ? "bg-[#486451]" : "bg-[#ded8cc]"
                    }`}
                  />
                ))}
                <span className="text-[11px] text-[#77786f]">
                  已填 {Object.entries(form).filter(([, v]) => v).length}/9 项
                </span>
              </div>

              {step < 2 ? (
                <button
                  type="button"
                  onClick={() => setStep(step + 1)}
                  className="rounded-xl bg-[#8a4d2e] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#b46d43]"
                >
                  继续
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-xl bg-[#8a4d2e] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#b46d43] disabled:opacity-50"
                >
                  {loading ? "分析中..." : "生成策略报告"}
                </button>
              )}
            </div>
          </div>
        </div>
      </form>

      {/* Privacy note */}
      <p className="mt-4 text-center text-[11px] text-[#77786f]">
        未配置远程 AI 时使用本地引擎；配置后内容会由服务器发送至你指定的 OpenAI-compatible 服务。
      </p>
    </div>
  );
}

function DecisionField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  textarea,
  rows,
  maxLength,
  required,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
  rows?: number;
  maxLength?: number;
  required?: boolean;
}) {
  const chars = value?.length || 0;
  const Tag = textarea ? "textarea" : "input";
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-bold text-[#555]">
          {label}
          {required && <span className="ml-0.5 text-[#8a4d2e]">*</span>}
        </span>
        {hint && <span className="text-[11px] text-[#77786f]">{hint}</span>}
      </div>
      <Tag
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        required={required}
        className="w-full rounded-xl border border-[#ded8cc] bg-[#f4f1ea] px-4 py-3 text-sm outline-none transition-colors focus:border-[#8a4d2e] focus:ring-2 focus:ring-[#8a4d2e]/10"
      />
      {maxLength && (
        <p className="mt-1 text-right text-[11px] text-[#77786f]">{chars}/{maxLength}</p>
      )}
    </label>
  );
}
