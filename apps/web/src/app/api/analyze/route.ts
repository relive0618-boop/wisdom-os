import { NextResponse } from "next/server";
import knowledgeData from "@/lib/knowledge.json" with { type: "json" };
import casesData from "@/lib/cases.json" with { type: "json" };
import { createEngine } from "@/lib/engine.js";
import { AnalyzeInputSchema, AnalyzeResponseSchema, ReportSchema } from "@wisdom/shared";
import { requestRemoteReport } from "@/lib/ai";

const { retrieve, buildLocalReport, buildPrompt } = createEngine(knowledgeData, casesData);

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
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
    const remote = await requestRemoteReport(
      retrieved,
      buildPrompt(input.data, retrieved),
      decisionId,
      reportId,
    );
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
    });
    return NextResponse.json(response);
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "分析服务暂时无法完成请求。");
  }
}
