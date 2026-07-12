function createEngine(knowledge, cases) {
  const categoryMap = {
    创业: ["创业", "产品", "市场", "现金流", "竞争", "客户", "商业"],
    职场: ["职场", "老板", "同事", "升职", "离职", "部门", "工作"],
    谈判: ["谈判", "价格", "合同", "客户", "薪资", "条件", "压价"],
    管理: ["管理", "团队", "员工", "组织", "执行", "协作", "绩效"],
    学习: ["学习", "考试", "课程", "训练", "技能", "知识"],
    人际: ["朋友", "关系", "沟通", "冲突", "家庭", "伴侣"],
    投资: ["投资", "基金", "股票", "资产", "收益", "亏损", "买入"],
  };

  function textOf(input) {
    return [
      input.title, input.question, input.background, input.goal,
      input.resources, input.constraints, input.risks,
    ].filter(Boolean).join(" ");
  }

  function tokenize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[，。！？、；：,.!?;:\n\r\t]/g, " ")
      .split(/\s+/)
      .flatMap((x) => (x.length > 2 ? [x, ...Array.from(x)] : [x]))
      .filter(Boolean);
  }

  function detectCategory(text, requested) {
    if (requested && requested !== "自动判断") return requested;
    let best = "综合决策", bestScore = 0;
    for (const [category, words] of Object.entries(categoryMap)) {
      const score = words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
      if (score > bestScore) { best = category; bestScore = score; }
    }
    return best;
  }

  function scoreKnowledge(item, text, category) {
    let score = 0;
    const hay = [item.title, item.chapter, item.plain, item.principle, ...item.tags, ...item.applications].join(" ");
    for (const token of tokenize(text)) {
      if (token.length > 1 && hay.includes(token)) score += token.length > 2 ? 2 : 0.5;
    }
    if (item.applications.includes(category)) score += 5;
    if (category === "综合决策" && ["评估", "风险", "验证"].some((t) => item.tags.includes(t))) score += 2;
    return score;
  }

  function retrieve(input) {
    const text = textOf(input);
    const category = detectCategory(text, input.category);
    const ranked = knowledge
      .map((item) => ({ ...item, _score: scoreKnowledge(item, text, category) }))
      .sort((a, b) => b._score - a._score);
    let selected = ranked.filter((x) => x._score > 0).slice(0, 5);
    if (selected.length < 3) {
      const fallback = knowledge.filter((x) =>
        ["mou-002", "xing-001", "yongjian-001", "ji-001"].includes(x.id)
      );
      selected = [...selected, ...fallback]
        .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i)
        .slice(0, 5);
    }
    const caseRanked = cases
      .map((c) => ({
        ...c,
        _score: c.tags.reduce(
          (s, t) => s + (text.includes(t) || selected.some((k) => k.tags.includes(t)) ? 1 : 0),
          0
        ),
      }))
      .sort((a, b) => b._score - a._score)
      .slice(0, 3);
    return { category, knowledge: selected, cases: caseRanked };
  }

  function buildLocalReport(input, retrieved) {
    const k = retrieved.knowledge;
    const main = k[0];
    const second = k[1] || main;
    const third = k[2] || main;
    const constraints = input.constraints || "目前没有补充限制";
    const risks = input.risks || "尚未列出明确风险";
    return {
      mode: "local",
      category: retrieved.category,
      problem_summary: `你正在处理"${input.title || input.question || "当前问题"}"。目标是${input.goal || "找到更稳妥的行动方向"}，同时需要考虑：${constraints}。`,
      core_conflict: `当前核心矛盾不是单纯"做或不做"，而是如何在收益、成本、时机与可承受风险之间取得平衡。`,
      situation_assessment: `从《${main.chapter}"${main.title}"》来看，第一步应当是${main.principle}。同时结合"${second.title}"，需要避免在信息不足或资源不稳时被迫跟随外部节奏。`,
      citations: k.map((x) => ({
        id: x.id,
        chapter: x.chapter,
        title: x.title,
        source: x.source,
        explanation: x.plain,
      })),
      strategies: [
        {
          name: "稳健方案",
          position: "先降低下行风险，再逐步验证。",
          actions: [
            `列出最坏情况与可承受损失，并为"${input.title || "这项决策"}"设置停止条件。`,
            "先做一个低成本、小范围、可逆的验证。",
            "收集至少两类独立信息，避免只依据单一观点。",
          ],
          suitable_when: "资源有限、后果较大、信息仍不完整。",
          risk: "行动速度可能偏慢，需设定验证期限。",
        },
        {
          name: "平衡方案",
          position: "保持基本盘，同时主动改变议题或比较标准。",
          actions: [
            `把当前问题拆成"目标、筹码、限制、对方需求、时间窗口"五项。`,
            `寻找不必正面消耗的替代路径，运用"${second.principle}"。`,
            "设定一个明确节点，在取得新证据后再升级投入。",
          ],
          suitable_when: "需要推进，但不适合一次性押注。",
          risk: "需要持续跟踪，执行复杂度较高。",
        },
        {
          name: "进取方案",
          position: "在已有安全垫的前提下，抓住窗口主动推进。",
          actions: [
            `确认自身优势与对方弱点，避免在对方最强处竞争。`,
            `集中资源完成一个最关键突破，而不是平均分配。`,
            "预先准备退出、转向或重新谈判方案。",
          ],
          suitable_when: "时机明确、资源可控、失败成本可承受。",
          risk: "判断错误时，资源消耗会更快。",
        },
      ],
      recommended_strategy: `优先采用"平衡方案"。原因是它同时符合"${main.title}"与"${third.title}"的原则：既不盲目正面对抗，也不因过度等待而失去主动。`,
      risks: [
        `信息风险：${risks}。需要区分事实、推测与情绪。`,
        "资源风险：时间、现金、注意力或关系成本可能被低估。",
        "执行风险：方案如果没有触发条件与截止日期，容易长期拖延。",
        "认知风险：不要把经典解释当成对未来的保证。",
      ],
      action_plan_7d: [
        "第1天：写下目标、底线与不可接受结果。",
        "第2天：补齐关键事实，并标注信息来源。",
        "第3天：列出至少三种路径，不只保留二选一。",
        "第4天：为每种路径估算成本、收益和失败后果。",
        "第5天：执行一个低成本验证。",
        "第6天：根据结果修正判断。",
        "第7天：决定继续、调整、暂停或退出。",
      ],
      review_questions: [
        "我真正想解决的问题是什么？",
        "我是否正在对方设定的战场上消耗？",
        "哪些判断是事实，哪些只是推测？",
        "最小可逆行动是什么？",
        "什么条件出现时，我应该停止或转向？",
      ],
      case_refs: retrieved.cases,
      disclaimer:
        "本报告用于文化学习、思维训练与一般决策辅助，不构成医疗、法律、投资、税务或其他专业意见。",
    };
  }

  function validateReport(report) {
    const required = [
      "problem_summary",
      "core_conflict",
      "situation_assessment",
      "citations",
      "strategies",
      "recommended_strategy",
      "risks",
      "action_plan_7d",
      "review_questions",
      "disclaimer",
    ];
    const missing = required.filter((k) => report[k] === undefined || report[k] === null);
    if (missing.length) return { ok: false, missing };
    if (!Array.isArray(report.citations) || report.citations.length === 0)
      return { ok: false, missing: ["citations"] };
    if (!Array.isArray(report.strategies) || report.strategies.length < 2)
      return { ok: false, missing: ["strategies"] };
    return { ok: true, missing: [] };
  }

  function buildPrompt(input, retrieved) {
    return `你是"AI孙子兵法决策助手"。只能引用下方已审核知识，不得伪造原文，不得预测未来，不得使用绝对化结论。
请输出严格 JSON，字段必须是：
problem_summary, core_conflict, situation_assessment, citations, strategies, recommended_strategy, risks, action_plan_7d, review_questions, disclaimer。
strategies 必须有3项，每项包含 name, position, actions, suitable_when, risk。
用户问题：
${JSON.stringify(input, null, 2)}

已审核知识：
${JSON.stringify(
  retrieved.knowledge.map((x) => ({
    id: x.id,
    chapter: x.chapter,
    title: x.title,
    source: x.source,
    plain: x.plain,
    principle: x.principle,
    limits: x.limits,
  })),
  null,
  2
)}

相关案例：
${JSON.stringify(retrieved.cases, null, 2)}

要求：
1. 至少引用2条已审核知识。
2. citations 中的 source 必须逐字来自已审核知识。
3. 至少列出3项风险与5项七日行动。
4. 明确适用边界。
5. 只输出 JSON。`;
  }

  return { retrieve, buildLocalReport, validateReport, buildPrompt };
}

module.exports = { createEngine };
