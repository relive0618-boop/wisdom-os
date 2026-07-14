import { NextResponse } from "next/server";
import knowledgeData from "@/lib/knowledge.json" with { type: "json" };
import casesData from "@/lib/cases.json" with { type: "json" };
import { createEngine } from "@/lib/engine.js";
import { AnalyzeInputSchema, AnalyzeResponseSchema, ReportSchema } from "@wisdom/shared";
import { requestRemoteReport } from "@/lib/ai";
import { checkRateLimitForRequest, getClientIp } from "@/lib/rateLimit";

const { retrieve, buildLocalReport, buildPrompt } = createEngine(knowledgeData, casesData);

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const rate = await checkRateLimitForRequest(getClientIp(request));
  if (!rate.allowed) return errorResponse(429, "RATE_LIMITED", "请求过于频繁，请稍后再试。");

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "请求必须是有效 JSON。");
  }

  const input = AnalyzeInputSchema.safeParse(rawBody);
  if (!input.success) {
    return errorResponse(422, "INVALID_INPUT", "输入内容不符合要求。");
  }

  try {
    const decisionId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    const cycleId = crypto.randomUUID();
    const retrieved = retrieve(input.data);
    const shouldUseRemote = input.data.analysisMode !== "local";
    const remote = shouldUseRemote
      ? await requestRemoteReport(
          retrieved,
          buildPrompt(input.data, retrieved),
          decisionId,
          reportId,
          input.data,
        )
      : {
          report: null,
          errorCode: "USER_SELECTED_LOCAL" as const,
          provider: "local",
          model: null,
          quality: { qualityScore: 100, qualityWarnings: [], qualityPassed: true },
          attempted: false,
          succeeded: false,
          latencyMs: 0,
          attempts: 0,
          repaired: false,
          providerPayloadParsed: false,
          providerContentPresent: false,
          providerContentShape: "missing" as const,
          providerContentLength: null,
          providerFinishReason: null,
          providerJsonExtraction: "not_attempted" as const,
          providerPromptTokens: null,
          providerCompletionTokens: null,
          providerReasoningPresent: false,
          providerReasoningLength: null,
          providerSchemaIssueCount: 0,
          providerSchemaIssuePaths: [],
        };
    const report = remote.report ?? ReportSchema.parse({
      ...buildLocalReport(input.data, retrieved),
      decisionId,
      reportId,
      mode: "local",
    });
    const response = AnalyzeResponseSchema.parse({
      decisionId,
      reportId,
      cycleId,
      report,
      remoteError: remote.errorCode,
      retrievedAt: new Date().toISOString(),
      analysisMode: input.data.analysisMode,
      provider: remote.report ? remote.provider : "local",
      model: remote.report ? remote.model : null,
      qualityScore: remote.report ? remote.quality.qualityScore : 100,
      qualityWarnings: remote.report ? remote.quality.qualityWarnings : [],
      qualityPassed: remote.report ? remote.quality.qualityPassed : true,
      fallbackReason: remote.report ? null : remote.errorCode,
      remoteAttempted: remote.attempted,
      remoteSucceeded: remote.succeeded,
      remoteLatencyMs: remote.attempted ? remote.latencyMs : null,
      remoteAttempts: remote.attempts,
      remoteRepaired: remote.repaired,
      remotePayloadParsed: remote.providerPayloadParsed,
      remoteContentPresent: remote.providerContentPresent,
      remoteContentShape: remote.providerContentShape,
      remoteContentLength: remote.providerContentLength,
      remoteFinishReason: remote.providerFinishReason,
      remoteJsonExtraction: remote.providerJsonExtraction,
      remotePromptTokens: remote.providerPromptTokens,
      remoteCompletionTokens: remote.providerCompletionTokens,
      remoteReasoningPresent: remote.providerReasoningPresent,
      remoteReasoningLength: remote.providerReasoningLength,
      remoteSchemaIssueCount: remote.providerSchemaIssueCount,
      remoteSchemaIssuePaths: remote.providerSchemaIssuePaths,
    });
    return NextResponse.json(response);
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "分析服务暂时无法完成请求。");
  }
}
