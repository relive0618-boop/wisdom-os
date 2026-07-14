import { ReportSchema, ReportQualitySchema } from "@wisdom/shared";
import { validateCitationProvenance } from "./citations";
import { remoteConfig } from "./config";
import { isTimeoutError, type RemoteErrorCode } from "./errors";
import { assessReportQuality } from "./quality";
import { extractAssistantText, extractJsonObject, payloadDiagnostics } from "./responseParser";
import { emptyProviderDiagnostics, type AiProvider, type ProviderDiagnostics, type ProviderInput, type ProviderResult } from "./types";

const REPAIR_MIN_REMAINING_MS = 10_000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function failedResult(
  errorCode: RemoteErrorCode,
  model: string | null,
  options: {
    warnings?: string[];
    latencyMs?: number;
    attempts?: number;
    repaired?: boolean;
    diagnostics?: ProviderDiagnostics;
  } = {},
): ProviderResult {
  return {
    report: null,
    errorCode,
    provider: "openai-compatible",
    model,
    quality: ReportQualitySchema.parse({ qualityScore: 0, qualityWarnings: options.warnings ?? [], qualityPassed: false }),
    attempted: (options.attempts ?? 0) > 0,
    succeeded: false,
    latencyMs: options.latencyMs ?? 0,
    attempts: options.attempts ?? 0,
    repaired: options.repaired ?? false,
    ...(options.diagnostics ?? emptyProviderDiagnostics()),
  };
}

function withMetrics(result: ProviderResult, startedAt: number, attempts: number, repaired = result.repaired): ProviderResult {
  return { ...result, latencyMs: Math.max(0, Date.now() - startedAt), attempts, repaired };
}

function diagnosticsOf(result: ProviderResult): ProviderDiagnostics {
  return {
    providerPayloadParsed: result.providerPayloadParsed,
    providerContentPresent: result.providerContentPresent,
    providerContentShape: result.providerContentShape,
    providerContentLength: result.providerContentLength,
    providerFinishReason: result.providerFinishReason,
    providerJsonExtraction: result.providerJsonExtraction,
    providerPromptTokens: result.providerPromptTokens,
    providerCompletionTokens: result.providerCompletionTokens,
    providerReasoningPresent: result.providerReasoningPresent,
    providerReasoningLength: result.providerReasoningLength,
  };
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
        {
          warnings: first.quality.qualityWarnings,
          latencyMs: Math.max(0, Date.now() - startedAt),
          attempts: first.attempts,
          diagnostics: diagnosticsOf(first),
        },
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
      {
        warnings: repaired.quality.qualityWarnings.length ? repaired.quality.qualityWarnings : first.quality.qualityWarnings,
        latencyMs: Math.max(0, Date.now() - startedAt),
        attempts: totalAttempts,
        repaired: true,
        diagnostics: diagnosticsOf(repaired),
      },
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
      if (remainingMs <= 0) return failedResult("REMOTE_TIMEOUT", config.model, { latencyMs: Math.max(0, Date.now() - startedAt), attempts });
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
        if (config.thinkingMode !== "provider_default") {
          requestBody.chat_template_kwargs = { enable_thinking: config.thinkingMode === "on" };
        }
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
          return failedResult("REMOTE_HTTP_ERROR", config.model, { latencyMs: Math.max(0, Date.now() - startedAt), attempts });
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          return failedResult("REMOTE_INVALID_JSON", config.model, { latencyMs: Math.max(0, Date.now() - startedAt), attempts });
        }
        const diagnostics = payloadDiagnostics(payload);
        const assistant = extractAssistantText(payload);
        if (assistant.text === null) {
          return failedResult("REMOTE_INVALID_JSON", config.model, { latencyMs: Math.max(0, Date.now() - startedAt), attempts, diagnostics });
        }

        const extracted = extractJsonObject(assistant.text);
        const extractionDiagnostics = { ...diagnostics, providerJsonExtraction: extracted.method };
        if (!extracted.value) {
          return failedResult("REMOTE_INVALID_JSON", config.model, {
            latencyMs: Math.max(0, Date.now() - startedAt),
            attempts,
            diagnostics: extractionDiagnostics,
          });
        }
        const parsed = ReportSchema.safeParse({
          ...extracted.value,
          decisionId: input.decisionId,
          reportId: input.reportId,
          mode: "remote",
          case_refs: input.retrieved.cases,
        });
        if (!parsed.success) {
          return failedResult("REMOTE_SCHEMA_INVALID", config.model, {
            latencyMs: Math.max(0, Date.now() - startedAt),
            attempts,
            diagnostics: extractionDiagnostics,
          });
        }
        const validated = validateCitationProvenance(parsed.data, input.retrieved);
        if (!validated) {
          return failedResult("REMOTE_CITATION_INVALID", config.model, {
            latencyMs: Math.max(0, Date.now() - startedAt),
            attempts,
            diagnostics: extractionDiagnostics,
          });
        }
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
          ...extractionDiagnostics,
        };
      } catch (error) {
        if (isTimeoutError(error)) {
          return failedResult("REMOTE_TIMEOUT", config.model, { latencyMs: Math.max(0, Date.now() - startedAt), attempts });
        }
        if (retry < config.maxRetries) continue;
        return failedResult("REMOTE_HTTP_ERROR", config.model, { latencyMs: Math.max(0, Date.now() - startedAt), attempts });
      }
    }
    return failedResult("REMOTE_HTTP_ERROR", config.model, { latencyMs: Math.max(0, Date.now() - startedAt), attempts });
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
