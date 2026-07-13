import { ReportSchema, type Report, type RetrievalResult } from "@wisdom/shared";

const REQUEST_TIMEOUT_MS = 25_000;

export type RemoteErrorCode =
  | "REMOTE_NOT_CONFIGURED"
  | "REMOTE_TIMEOUT"
  | "REMOTE_HTTP_ERROR"
  | "REMOTE_INVALID_JSON"
  | "REMOTE_SCHEMA_INVALID"
  | "REMOTE_CITATION_INVALID";

function extractJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

export function remoteConfig() {
  return {
    baseUrl: process.env.AI_BASE_URL?.trim() || null,
    apiKey: process.env.AI_API_KEY?.trim() || null,
    model: process.env.AI_MODEL?.trim() || null,
  };
}

export function validateCitationProvenance(
  report: Report,
  retrieved: RetrievalResult,
): Report | null {
  const knowledgeById = new Map(retrieved.knowledge.map((item) => [item.id, item]));
  const validCitations = report.citations.filter((citation) => {
    const source = knowledgeById.get(citation.id);
    return Boolean(
      source &&
        citation.chapter === source.chapter &&
        citation.title === source.title &&
        citation.source === source.source,
    );
  });

  if (validCitations.length < 2) return null;
  return ReportSchema.parse({ ...report, citations: validCitations });
}

export async function requestRemoteReport(
  retrieved: RetrievalResult,
  prompt: string,
  decisionId: string,
  reportId: string,
): Promise<{ report: Report | null; errorCode: RemoteErrorCode | null }> {
  const config = remoteConfig();
  if (!config.baseUrl || !config.apiKey || !config.model) {
    return { report: null, errorCode: "REMOTE_NOT_CONFIGURED" };
  }

  try {
    const response = await fetch(config.baseUrl, {
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) return { report: null, errorCode: "REMOTE_HTTP_ERROR" };

    let payload: { choices?: Array<{ message?: { content?: string } }> };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      return { report: null, errorCode: "REMOTE_INVALID_JSON" };
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content) return { report: null, errorCode: "REMOTE_INVALID_JSON" };

    let candidate: unknown;
    try {
      candidate = extractJson(content);
    } catch {
      return { report: null, errorCode: "REMOTE_INVALID_JSON" };
    }

    const parsed = ReportSchema.safeParse({
      ...(candidate as object),
      decisionId,
      reportId,
      mode: "remote",
      case_refs: retrieved.cases,
    });
    if (!parsed.success) return { report: null, errorCode: "REMOTE_SCHEMA_INVALID" };

    const validated = validateCitationProvenance(parsed.data, retrieved);
    if (!validated) return { report: null, errorCode: "REMOTE_CITATION_INVALID" };
    return { report: validated, errorCode: null };
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { report: null, errorCode: "REMOTE_TIMEOUT" };
    }
    return { report: null, errorCode: "REMOTE_HTTP_ERROR" };
  }
}
