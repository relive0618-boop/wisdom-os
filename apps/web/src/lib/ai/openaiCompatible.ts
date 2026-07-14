import { ReportSchema, ReportQualitySchema } from "@wisdom/shared";
import { validateCitationProvenance } from "./citations";
import { remoteConfig } from "./config";
import { isTimeoutError, type RemoteErrorCode } from "./errors";
import { assessReportQuality } from "./quality";
import type { AiProvider, ProviderInput, ProviderResult } from "./types";

const REPAIR_MIN_REMAINING_MS = 10_000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function extractJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

function failedResult(
  errorCode: RemoteErrorCode,
  model: string | null,
  warnings: string[] = [],
  latencyMs = 0,
  attempts = 0,
  repaired = false,
): ProviderResult {
  return {
    report: null,
    errorCode,
    provider: "openai-compatible",
    model,
    quality: ReportQualitySchema.parse({ qualityScore: 0, qualityWarnings: warnings, qualityPassed: false }),
    attempted: attempts > 0,
    succeeded: false,
    latencyMs,
    attempts,
    repaired,
  };
}

function withMetrics(result: ProviderResult, startedAt: number, attempts: number, repaired = result.repaired): ProviderResult {
  return { ...result, latencyMs: Math.max(0, Date.now() - startedAt), attempts, repaired };
}

export class OpenAiCompatibleProvider implements AiProvider {
  async generateReport(input: ProviderInput): Promise<ProviderResult> {
    const config = remoteConfig();
    if (!config.baseUrl || !config.apiKey || !config.model) {
      return { ...failedResult("REMOTE_NOT_CONFIGURED", config.model), attempted: false };
    }

    const startedAt = Date.now();
    const deadline = startedAt + config.totalBudgetMs;
    const first = await this.request(input, input.prompt, config, deadline);
    if (!first.report || first.quality.qualityPassed) {
      return withMetrics(first, startedAt, first.attempts);
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs < REPAIR_MIN_REMAINING_MS) {
      return failedResult(
        "REMOTE_QUALITY_FAILED",
        config.model,
        first.quality.qualityWarnings,
        Math.max(0, Date.now() - startedAt),
        first.attempts,
      );
    }

    const repairPrompt = `${input.prompt}\n品質修復要求：上一版報告未通過品質檢查。請只修復以下問題並輸出完整 JSON，不要重新檢索知識：\n${first.quality.qualityWarnings.map((warning) => `- ${warning}`).join("\n")}`;
    const repaired = await this.request(input, repairPrompt, config, deadline);
    const totalAttempts = first.attempts + repaired.attempts;
    if (repaired.report && repaired.quality.qualityPassed) {
      return withMetrics(repaired, startedAt, totalAttempts, true);
    }
    return failedResult(
      "REMOTE_QUALITY_FAILED",
      config.model,
      repaired.quality.qualityWarnings.length ? repaired.quality.qualityWarnings : first.quality.qualityWarnings,
      Math.max(0, Date.now() - startedAt),
      totalAttempts,
      true,
    );
  }

  private async request(
    input: ProviderInput,
    prompt: string,
    config: ReturnType<typeof remoteConfig>,
    deadline: number,
  ): Promise<ProviderResult> {
    const startedAt = Date.now();
    let attempts = 0;
    for (let retry = 0; retry <= config.maxRetries; retry += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return failedResult("REMOTE_TIMEOUT", config.model, [], Math.max(0, Date.now() - startedAt), attempts);
      attempts += 1;
      try {
        const requestBody: Record<string, unknown> = {
          model: config.model,
          temperature: 0.1,
          max_tokens: config.maxOutputTokens,
          stream: false,
          messages: [
            { role: "system", content: "你是严格输出 JSON 的决策分析助手。" },
            { role: "user", content: prompt },
          ],
        };
        if (config.responseFormatMode === "json_object") requestBody.response_format = { type: "json_object" };
        const response = await fetch(config.baseUrl as string, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(Math.min(config.timeoutMs, remainingMs)),
        });
        if (!response.ok) {
          if (RETRYABLE_STATUS_CODES.has(response.status) && retry < config.maxRetries) continue;
          return failedResult("REMOTE_HTTP_ERROR", config.model, [], Math.max(0, Date.now() - startedAt), attempts);
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          return failedResult("REMOTE_INVALID_JSON", config.model, [], Math.max(0, Date.now() - startedAt), attempts);
        }
        const content = (payload as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
        if (!content) return failedResult("REMOTE_INVALID_JSON", config.model, [], Math.max(0, Date.now() - startedAt), attempts);

        let candidate: unknown;
        try {
          candidate = extractJson(content);
        } catch {
          return failedResult("REMOTE_INVALID_JSON", config.model, [], Math.max(0, Date.now() - startedAt), attempts);
        }
        const parsed = ReportSchema.safeParse({
          ...(candidate as object),
          decisionId: input.decisionId,
          reportId: input.reportId,
          mode: "remote",
          case_refs: input.retrieved.cases,
        });
        if (!parsed.success) return failedResult("REMOTE_SCHEMA_INVALID", config.model, [], Math.max(0, Date.now() - startedAt), attempts);
        const validated = validateCitationProvenance(parsed.data, input.retrieved);
        if (!validated) return failedResult("REMOTE_CITATION_INVALID", config.model, [], Math.max(0, Date.now() - startedAt), attempts);
        const quality = assessReportQuality(validated, input.input.question);
        return {
          report: validated,
          errorCode: null,
          provider: "openai-compatible",
          model: config.model,
          quality,
          attempted: true,
          succeeded: quality.qualityPassed,
          latencyMs: Math.max(0, Date.now() - startedAt),
          attempts,
          repaired: false,
        };
      } catch (error) {
        if (isTimeoutError(error)) return failedResult("REMOTE_TIMEOUT", config.model, [], Math.max(0, Date.now() - startedAt), attempts);
        if (retry < config.maxRetries) continue;
        return failedResult("REMOTE_HTTP_ERROR", config.model, [], Math.max(0, Date.now() - startedAt), attempts);
      }
    }
    return failedResult("REMOTE_HTTP_ERROR", config.model, [], Math.max(0, Date.now() - startedAt), attempts);
  }
}

export async function requestRemoteReport(
  retrieved: ProviderInput["retrieved"],
  prompt: string,
  decisionId: string,
  reportId: string,
  input: ProviderInput["input"] = { question: "", title: "", category: "自动判断", background: "", goal: "", resources: "", constraints: "", risks: "", deadline: "", analysisMode: "auto" },
) {
  return new OpenAiCompatibleProvider().generateReport({ retrieved, prompt, decisionId, reportId, input });
}
