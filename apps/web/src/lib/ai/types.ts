import type { AnalyzeInput, Report, RetrievalResult, ReportQuality } from "@wisdom/shared";
import type { RemoteErrorCode } from "./errors";

export interface ProviderInput {
  input: AnalyzeInput;
  retrieved: RetrievalResult;
  prompt: string;
  decisionId: string;
  reportId: string;
}

export interface ProviderResult {
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
