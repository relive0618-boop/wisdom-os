import test from "node:test";
import assert from "node:assert/strict";
import {
  extractAssistantText,
  extractFinishReason,
  extractJsonObject,
  extractReasoningDiagnostics,
  extractUsage,
} from "./ai/responseParser";

const object = JSON.stringify({ problem_summary: "測試", nested: { value: true }, entries: [{ id: "one" }] });

test("純 JSON 使用 direct 擷取", () => {
  assert.equal(extractJsonObject(object).method, "direct");
});

test("UTF-8 BOM 加 JSON 使用 direct 擷取", () => {
  assert.equal(extractJsonObject(`\uFEFF${object}`).method, "direct");
});

test("完整 json code fence 使用 fenced 擷取", () => {
  assert.equal(extractJsonObject(`\`\`\`json\n${object}\n\`\`\``).method, "fenced");
});

test("fence 前有文字仍使用 fenced 擷取", () => {
  assert.equal(extractJsonObject(`以下是結果：\n\`\`\`json\n${object}\n\`\`\``).method, "fenced");
});

test("fence 後有文字仍使用 fenced 擷取", () => {
  assert.equal(extractJsonObject(`\`\`\`\n${object}\n\`\`\`\n以上完成。`).method, "fenced");
});

test("JSON 前有說明文字使用 balanced_object 擷取", () => {
  assert.equal(extractJsonObject(`這裡是結果：\n${object}`).method, "balanced_object");
});

test("JSON 後有尾註使用 balanced_object 擷取", () => {
  assert.equal(extractJsonObject(`${object}\n以上是分析結果。`).method, "balanced_object");
});

test("JSON 字串內含大括號可正確擷取", () => {
  const value = JSON.stringify({ note: "字串中的 { 與 } 不應影響掃描" });
  assert.equal(extractJsonObject(`前言 ${value} 尾註`).method, "balanced_object");
});

test("JSON 字串內含 escaped quote 可正確擷取", () => {
  const value = JSON.stringify({ note: '文字含有 " 引號與 }' });
  assert.equal(extractJsonObject(`前言 ${value} 尾註`).method, "balanced_object");
});

test("巢狀 object 可正確擷取", () => {
  const value = JSON.stringify({ outer: { inner: { valid: true } } });
  assert.equal(extractJsonObject(`前言${value}尾註`).value?.outer instanceof Object, true);
});

test("array field 含 objects 可正確擷取", () => {
  const value = JSON.stringify({ citations: [{ id: "a" }, { id: "b" }] });
  assert.equal(extractJsonObject(`前言${value}尾註`).method, "balanced_object");
});

test("缺少 closing brace 會失敗", () => {
  assert.equal(extractJsonObject("前言 {\"key\": true").method, "failed");
});

test("trailing comma 會失敗", () => {
  assert.equal(extractJsonObject('{"key": true,}').method, "failed");
});

test("single quote object 會失敗", () => {
  assert.equal(extractJsonObject("{'key': true}").method, "failed");
});

test("content array 的 text blocks 可拼接", () => {
  const result = extractAssistantText({ choices: [{ message: { content: [{ type: "text", text: "前" }, { type: "text", text: "後" }] } }] });
  assert.deepEqual(result, { text: "前後", present: true, shape: "text_blocks", length: 2 });
});

test("content 缺少時安全標記 missing", () => {
  assert.deepEqual(extractAssistantText({ choices: [{ message: {} }] }), { text: null, present: false, shape: "missing", length: null });
});

test("content 不支援型別時安全標記 unsupported", () => {
  assert.deepEqual(extractAssistantText({ choices: [{ message: { content: 42 } }] }), { text: null, present: false, shape: "unsupported", length: null });
});

test("finish_reason stop 會安全映射", () => {
  assert.equal(extractFinishReason({ choices: [{ finish_reason: "stop" }] }), "stop");
});

test("finish_reason length 會安全映射", () => {
  assert.equal(extractFinishReason({ choices: [{ finish_reason: "length" }] }), "length");
});

test("未知 finish_reason 映射為 unknown", () => {
  assert.equal(extractFinishReason({ choices: [{ finish_reason: "provider-internal" }] }), "unknown");
});

test("usage token 數僅接受安全非負整數", () => {
  assert.deepEqual(extractUsage({ usage: { prompt_tokens: 123, completion_tokens: -1 } }), { promptTokens: 123, completionTokens: null });
});

test("reasoning_content string 只回傳存在與長度", () => {
  const marker = "private-reasoning-text";
  assert.deepEqual(extractReasoningDiagnostics({ choices: [{ message: { reasoning_content: marker } }] }), { present: true, length: marker.length });
});

test("reasoning array 只回傳安全總長度", () => {
  assert.deepEqual(extractReasoningDiagnostics({ choices: [{ message: { reasoning: ["前", { text: "後" }] } }] }), { present: true, length: 2 });
});

test("未知 reasoning 型別不洩漏內容", () => {
  assert.deepEqual(extractReasoningDiagnostics({ choices: [{ message: { reasoning: { private: "value" } } }] }), { present: true, length: null });
});
