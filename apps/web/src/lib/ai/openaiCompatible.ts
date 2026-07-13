import { ReportSchema, ReportQualitySchema } from "@wisdom/shared";
import { validateCitationProvenance } from "./citations";
import { remoteConfig } from "./config";
import { isTimeoutError, type RemoteErrorCode } from "./errors";
import { assessReportQuality } from "./quality";
import type { AiProvider, ProviderInput, ProviderResult } from "./types";

function extractJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

function failedResult(errorCode: RemoteErrorCode, model: string | null, warnings: string[] = []): ProviderResult {
  return {
    report: null,
    errorCode,
    provider: "openai-compatible",
    model,
    quality: ReportQualitySchema.parse({ qualityScore: 0, qualityWarnings: warnings, qualityPassed: false }),
    attempted: true,
    succeeded: false,
  };
}

export class OpenAiCompatibleProvider implements AiProvider {
  async generateReport(input: ProviderInput): Promise<ProviderResult> {
    const config = remoteConfig();
    if (!config.baseUrl || !config.apiKey || !config.model) {
      return { ...failedResult("REMOTE_NOT_CONFIGURED", config.model), attempted: false };
    }

    const result = await this.request(input, input.prompt, config);
    if (result.report && !result.quality.qualityPassed) {
      const repairPrompt = `${input.prompt}\n\n品質修復要求：上一版報告未通過品質檢查。請只修復以下問題並輸出完整 JSON，不要重新檢索知識：\n${result.quality.qualityWarnings.map((warning) => `- ${warning}`).join("\n")}`;
      const repaired = await this.request(input, repairPrompt, config);
      if (repaired.report && repaired.quality.qualityPassed) return repaired;
      return failedResult("REMOTE_QUALITY_FAILED", config.model, repaired.quality.qualityWarnings);
    }
    return result;
  }

  private async request(
    input: ProviderInput,
    prompt: string,
    config: ReturnType<typeof remoteConfig>,
  ): Promise<ProviderResult> {
    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      try {
        const response = await fetch(config.baseUrl as string, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: "你是严格输出 JSON 的决策分析助手。" },
              { role: "user", content: prompt },
            ],
          }),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
        if (!response.ok) return failedResult("REMOTE_HTTP_ERROR", config.model);

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          return failedResult("REMOTE_INVALID_JSON", config.model);
        }
        const content = (payload as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
        if (!content) return failedResult("REMOTE_INVALID_JSON", config.model);

        let candidate: unknown;
        try {
          candidate = extractJson(content);
        } catch {
          return failedResult("REMOTE_INVALID_JSON", config.model);
        }
        const parsed = ReportSchema.safeParse({
          ...(candidate as object),
          decisionId: input.decisionId,
          reportId: input.reportId,
          mode: "remote",
          case_refs: input.retrieved.cases,
        });
        if (!parsed.success) return failedResult("REMOTE_SCHEMA_INVALID", config.model);
        const validated = validateCitationProvenance(parsed.data, input.retrieved);
        if (!validated) return failedResult("REMOTE_CITATION_INVALID", config.model);
        const quality = assessReportQuality(validated, input.input.question);
        return { report: validated, errorCode: null, provider: "openai-compatible", model: config.model, quality, attempted: true, succeeded: quality.qualityPassed };
      } catch (error) {
        if (isTimeoutError(error)) return failedResult("REMOTE_TIMEOUT", config.model);
        if (attempt < config.maxRetries) continue;
        return failedResult("REMOTE_HTTP_ERROR", config.model);
      }
    }
    return failedResult("REMOTE_HTTP_ERROR", config.model);
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
