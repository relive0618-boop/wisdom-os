import test from "node:test";
import assert from "node:assert/strict";
import knowledge from "./knowledge.json" with { type: "json" };
import cases from "./cases.json" with { type: "json" };
import { createEngine } from "./engine.js";

test("local engine retrieves knowledge and produces a complete report", () => {
  const engine = createEngine(knowledge, cases);
  const input = {
    title: "是否进入新市场",
    question: "竞争对手领先，我要不要跟进？",
    category: "创业",
    background: "团队资源有限",
    goal: "降低试错成本",
    resources: "有一批老客户",
    constraints: "现金流需要保护",
    risks: "投入后没有回报",
  };
  const retrieved = engine.retrieve(input);
  const report = engine.buildLocalReport(input, retrieved);

  assert.equal(retrieved.category, "创业");
  assert.ok(retrieved.knowledge.length >= 3);
  assert.equal(report.strategies.length, 3);
  assert.equal(report.action_plan_7d.length, 7);
  assert.ok(report.citations.length >= 1);
  assert.equal(engine.validateReport(report).ok, true);
});

test("local engine prompt contains reviewed retrieval context", () => {
  const engine = createEngine(knowledge, cases);
  const retrieved = engine.retrieve({ question: "如何降低风险", category: "自动判断" });
  const prompt = engine.buildPrompt({ question: "如何降低风险", category: "自动判断" }, retrieved);
  assert.match(prompt, /只输出 JSON/);
  assert.match(prompt, /已审核知识/);
});
