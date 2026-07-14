import type {
  ProviderContentShape,
  ProviderDiagnostics,
  ProviderFinishReason,
  ProviderJsonExtraction,
} from "./types";

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function choice(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])) return null;
  return payload.choices[0];
}

export interface AssistantTextResult {
  text: string | null;
  present: boolean;
  shape: ProviderContentShape;
  length: number | null;
}

export function extractAssistantText(payload: unknown): AssistantTextResult {
  const selected = choice(payload);
  const message = selected && isRecord(selected.message) ? selected.message : null;
  const content = message?.content;
  if (typeof content === "string") {
    return { text: content, present: true, shape: "string", length: content.length };
  }
  if (Array.isArray(content)) {
    const texts = content.flatMap((block) => (
      isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []
    ));
    if (texts.length) {
      const text = texts.join("");
      return { text, present: true, shape: "text_blocks", length: text.length };
    }
    return { text: null, present: false, shape: "missing", length: null };
  }
  if (content === undefined || content === null) {
    return { text: null, present: false, shape: "missing", length: null };
  }
  return { text: null, present: false, shape: "unsupported", length: null };
}

export function extractFinishReason(payload: unknown): ProviderFinishReason {
  const value = choice(payload)?.finish_reason;
  if (value === null || value === undefined) return null;
  if (value === "stop" || value === "length" || value === "content_filter" || value === "tool_calls") return value;
  return "unknown";
}

export function extractUsage(payload: unknown) {
  const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : null;
  return {
    promptTokens: nonNegativeInteger(usage?.prompt_tokens),
    completionTokens: nonNegativeInteger(usage?.completion_tokens),
  };
}

function parseObject(text: string): JsonObject | null {
  try {
    const value: unknown = JSON.parse(text);
    return isJsonObject(value) ? value : null;
  } catch {
    return null;
  }
}

function fencedJson(content: string): JsonObject | null {
  const fences = /```(?:json)?[ \t]*\r?\n?([\s\S]*?)```/gi;
  for (const match of content.matchAll(fences)) {
    const parsed = parseObject(match[1].trim());
    if (parsed) return parsed;
  }
  return null;
}

function balancedObject(content: string): JsonObject | null {
  const start = content.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return parseObject(content.slice(start, index + 1));
    }
  }
  return null;
}

export interface JsonObjectResult {
  value: JsonObject | null;
  method: ProviderJsonExtraction;
}

export function extractJsonObject(content: string): JsonObjectResult {
  const trimmed = content.replace(/^\uFEFF/, "").trim();
  const direct = parseObject(trimmed);
  if (direct) return { value: direct, method: "direct" };
  const fenced = fencedJson(trimmed);
  if (fenced) return { value: fenced, method: "fenced" };
  const balanced = balancedObject(trimmed);
  if (balanced) return { value: balanced, method: "balanced_object" };
  return { value: null, method: "failed" };
}

export function payloadDiagnostics(payload: unknown): ProviderDiagnostics {
  const assistant = extractAssistantText(payload);
  const usage = extractUsage(payload);
  return {
    providerPayloadParsed: true,
    providerContentPresent: assistant.present,
    providerContentShape: assistant.shape,
    providerContentLength: assistant.length,
    providerFinishReason: extractFinishReason(payload),
    providerJsonExtraction: "not_attempted",
    providerPromptTokens: usage.promptTokens,
    providerCompletionTokens: usage.completionTokens,
  };
}
