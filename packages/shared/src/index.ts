import { z } from "zod";

// ─── Knowledge ──────────────────────────────────────────────────────────

export const KnowledgeItemSchema = z.object({
  id: z.string(),
  chapter: z.string(),
  title: z.string(),
  source: z.string(),
  plain: z.string(),
  principle: z.string(),
  counterexamples: z.string().optional(),
  applications: z.array(z.string()),
  limits: z.array(z.string()),
  tags: z.array(z.string()),
  case_ids: z.array(z.string()).optional(),
});

export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>;

// ─── Case ───────────────────────────────────────────────────────────────

export const CaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  scenario: z.string(),
  summary: z.string(),
  result: z.string(),
  lessons: z.array(z.string()),
  tags: z.array(z.string()),
  case_type: z.enum(["real", "composite"]).default("composite"),
  source_title: z.string().nullable().default(null),
  source_url: z.string().url().nullable().default(null),
  source_date: z.string().date().nullable().default(null),
  review_status: z.enum(["reviewed", "pending"]).default("reviewed"),
});

export type Case = z.infer<typeof CaseSchema>;

// ─── Retrieval ──────────────────────────────────────────────────────────

export const RetrievalResultSchema = z.object({
  category: z.string(),
  knowledge: z.array(KnowledgeItemSchema),
  cases: z.array(CaseSchema),
});

export type RetrievalResult = z.infer<typeof RetrievalResultSchema>;

// ─── Citation ──────────────────────────────────────────────────────────

export const CitationSchema = z.object({
  id: z.string(),
  chapter: z.string(),
  title: z.string(),
  source: z.string(),
  explanation: z.string().optional(),
});

export type Citation = z.infer<typeof CitationSchema>;

// ─── Strategy ──────────────────────────────────────────────────────────

export const StrategySchema = z.object({
  name: z.string().min(1),
  position: z.string().min(1),
  actions: z.array(z.string()).min(1),
  suitable_when: z.string().min(1),
  risk: z.string().min(1),
});

export type Strategy = z.infer<typeof StrategySchema>;

// ─── Report ─────────────────────────────────────────────────────────────

export const ReportSchema = z.object({
  decisionId: z.string().min(1),
  reportId: z.string().min(1),
  mode: z.enum(["local", "remote"]),
  category: z.string(),
  problem_summary: z.string().min(1),
  core_conflict: z.string().min(1),
  situation_assessment: z.string().min(1),
  citations: z.array(CitationSchema).min(1),
  strategies: z.array(StrategySchema).min(2),
  recommended_strategy: z.string().min(1),
  risks: z.array(z.string()).min(1),
  action_plan_7d: z.array(z.string()).length(7),
  review_questions: z.array(z.string()).min(1),
  case_refs: z.array(CaseSchema).optional(),
  disclaimer: z.string(),
});

export type Report = z.infer<typeof ReportSchema>;

export const RemoteReportContentSchema = ReportSchema.omit({
  decisionId: true,
  reportId: true,
  mode: true,
  category: true,
  case_refs: true,
});

export type RemoteReportContent = z.infer<typeof RemoteReportContentSchema>;

// ─── Analyze Input ──────────────────────────────────────────────────────

export const AnalyzeInputSchema = z.object({
  title: z.string().trim().max(80).optional().default(""),
  question: z.string().trim().min(1).max(2000),
  category: z.string().trim().min(1).max(80).optional().default("自动判断"),
  background: z.string().trim().max(4000).optional().default(""),
  goal: z.string().trim().max(1000).optional().default(""),
  resources: z.string().trim().max(2000).optional().default(""),
  constraints: z.string().trim().max(2000).optional().default(""),
  risks: z.string().trim().max(2000).optional().default(""),
  deadline: z.union([z.literal(""), z.string().date()]).optional().default(""),
  analysisMode: z.enum(["auto", "local", "remote"]).optional().default("auto"),
});

export type AnalyzeInput = z.infer<typeof AnalyzeInputSchema>;

// ─── Analyze Response ───────────────────────────────────────────────────

export const AnalyzeResponseSchema = z.object({
  decisionId: z.string().min(1),
  reportId: z.string().min(1),
  cycleId: z.string().min(1),
  report: ReportSchema,
  remoteError: z.string().nullable().optional(),
  retrievedAt: z.string(),
  analysisMode: z.enum(["auto", "local", "remote"]).default("auto"),
  provider: z.string().default("local"),
  model: z.string().nullable().default(null),
  qualityScore: z.number().min(0).max(100).default(100),
  qualityWarnings: z.array(z.string()).default([]),
  qualityPassed: z.boolean().default(true),
  fallbackReason: z.enum([
    "REMOTE_NOT_CONFIGURED",
    "REMOTE_TIMEOUT",
    "REMOTE_HTTP_ERROR",
    "REMOTE_INVALID_JSON",
    "REMOTE_SCHEMA_INVALID",
    "REMOTE_CITATION_INVALID",
    "REMOTE_QUALITY_FAILED",
    "USER_SELECTED_LOCAL",
  ]).nullable().default(null),
  remoteAttempted: z.boolean().default(false),
  remoteSucceeded: z.boolean().default(false),
  remoteLatencyMs: z.number().int().nonnegative().nullable().optional().default(null),
  remoteAttempts: z.number().int().nonnegative().optional().default(0),
  remoteRepaired: z.boolean().optional().default(false),
  remotePayloadParsed: z.boolean().optional().default(false),
  remoteContentPresent: z.boolean().optional().default(false),
  remoteContentShape: z.enum(["string", "text_blocks", "missing", "unsupported"]).optional().default("missing"),
  remoteContentLength: z.number().int().nonnegative().nullable().optional().default(null),
  remoteFinishReason: z.enum(["stop", "length", "content_filter", "tool_calls", "unknown"]).nullable().optional().default(null),
  remoteJsonExtraction: z.enum(["direct", "fenced", "balanced_object", "failed", "not_attempted"]).optional().default("not_attempted"),
  remotePromptTokens: z.number().int().nonnegative().nullable().optional().default(null),
  remoteCompletionTokens: z.number().int().nonnegative().nullable().optional().default(null),
  remoteReasoningPresent: z.boolean().optional().default(false),
  remoteReasoningLength: z.number().int().nonnegative().nullable().optional().default(null),
  remoteSchemaIssueCount: z.number().int().nonnegative().optional().default(0),
  remoteSchemaIssuePaths: z.array(z.string()).max(10).optional().default([]),
});

export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

export const ReportQualitySchema = z.object({
  qualityScore: z.number().min(0).max(100),
  qualityWarnings: z.array(z.string()),
  qualityPassed: z.boolean(),
});

export type ReportQuality = z.infer<typeof ReportQualitySchema>;

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  app: z.string(),
  remote: z.object({
    configured: z.boolean(),
    apiKeyConfigured: z.boolean(),
    provider: z.string().nullable(),
    safeBaseUrl: z.string().nullable(),
    model: z.string().nullable(),
    timeoutMs: z.number().int().positive(),
    maxRetries: z.number().int().min(0).max(1),
    maxOutputTokens: z.number().int().min(800).max(4000),
    responseFormatMode: z.enum(["prompt", "json_object"]),
    totalBudgetMs: z.number().int().min(15000).max(55000),
    thinkingMode: z.enum(["provider_default", "off", "on"]),
  }),
  mode: z.enum(["local", "remote"]),
  defaultMode: z.enum(["auto", "local", "remote"]),
});

export const PdcaItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  status: z.enum(["pending", "in_progress", "done", "blocked"]),
  note: z.string(),
  source: z.enum(["strategy", "action_plan", "custom"]),
  strategyName: z.string().optional(),
  createdAt: z.string().min(1),
});

export const PdcaCheckinSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  whatWorked: z.string(),
  whatDidnt: z.string(),
  lesson: z.string(),
  adjustNext: z.string(),
});

export const PdcaReflectionSchema = z.object({
  outcome: z.string(),
  keyLesson: z.string(),
  nextFocus: z.string(),
});

export const PdcaCycleSchema = z.object({
  id: z.string().min(1),
  cycleId: z.string().min(1),
  reportId: z.string().min(1),
  decisionId: z.string().min(1),
  cycleNumber: z.number().int().positive(),
  reportTitle: z.string(),
  reportCategory: z.string(),
  startedAt: z.string().min(1),
  completedAt: z.string().nullable(),
  items: z.array(PdcaItemSchema),
  checkins: z.array(PdcaCheckinSchema),
  reflection: PdcaReflectionSchema.nullable(),
  legacyKey: z.string().optional(),
});

export type PdcaItem = z.infer<typeof PdcaItemSchema>;
export type PdcaCheckin = z.infer<typeof PdcaCheckinSchema>;
export type PdcaCycle = z.infer<typeof PdcaCycleSchema>;
