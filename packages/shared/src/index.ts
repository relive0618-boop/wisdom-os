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

// ─── Analyze Input ──────────────────────────────────────────────────────

export const AnalyzeInputSchema = z.object({
  title: z.string().optional().default(""),
  question: z.string().optional().default(""),
  category: z.string().optional().default("自动判断"),
  background: z.string().optional().default(""),
  goal: z.string().optional().default(""),
  resources: z.string().optional().default(""),
  constraints: z.string().optional().default(""),
  risks: z.string().optional().default(""),
});

export type AnalyzeInput = z.infer<typeof AnalyzeInputSchema>;

// ─── Analyze Response ───────────────────────────────────────────────────

export const AnalyzeResponseSchema = z.object({
  report: ReportSchema,
  remoteError: z.string().nullable().optional(),
  retrievedAt: z.string(),
});

export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
