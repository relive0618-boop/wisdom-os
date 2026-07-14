import type { AnalyzeInput, Report, RetrievalResult, ReportQuality } from "@wisdom/shared";
import type { RemoteErrorCode } from "./errors";

export type ProviderContentShape = "string" | "text_blocks" | "missing" | "unsupported";
export type ProviderFinishReason = "stop" | "length" | "content_filter" | "tool_calls" | "unknown" | null;
export type ProviderJsonExtraction = "direct" | "fenced" | "balanced_object" | "failed" | "not_attempted";

export interface ProviderDiagnostics {
  providerPayloadParsed: boolean;
  providerContentPresent: boolean;
  providerContentShape: ProviderContentShape;
  providerContentLength: number | null;
  providerFinishReason: ProviderFinishReason;
  providerJsonExtraction: ProviderJsonExtraction;
  providerPromptTokens: number | null;
  providerCompletionTokens: number | null;
  providerReasoningPresent: boolean;
  providerReasoningLength: number | null;
}

export function emptyProviderDiagnostics(): ProviderDiagnostics {
  return {
    providerPayloadParsed: false,
    providerContentPresent: false,
    providerContentShape: "missing",
    providerContentLength: null,
    providerFinishReason: null,
    providerJsonExtraction: "not_attempted",
    providerPromptTokens: null,
    providerCompletionTokens: null,
    providerReasoningPresent: false,
    providerReasoningLength: null,
  };
}

export interface ProviderInput {
  input: AnalyzeInput;
  retrieved: RetrievalResult;
  prompt: string;
  decisionId: string;
  reportId: string;
}

export interface ProviderResult extends ProviderDiagnostics {
  report: Report | null;
  errorCode: RemoteErrorCode | null;
  provider: string;
  model: string | null;
  quality: ReportQuality;
  attempted: boolean;
  succeeded: boolean;
  latencyMs: number;
  attempts: number;
  repaired: boolean;
}

export interface AiProvider {
  generateReport(input: ProviderInput): Promise<ProviderResult>;
}
