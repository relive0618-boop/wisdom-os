import "server-only";
import type { Case, KnowledgeItem } from "@wisdom/shared";
import { CaseSchema, KnowledgeItemSchema } from "@wisdom/shared";
import localCases from "@/lib/cases.json";
import localKnowledge from "@/lib/knowledge.json";
import { supabaseConfig } from "@/lib/supabase/config";
import { getServerSupabaseClient } from "@/lib/supabase/server";

export interface ContentRepository { knowledge(): Promise<{ data: KnowledgeItem[]; source: "local" | "cloud" | "local_fallback" }>; cases(): Promise<{ data: Case[]; source: "local" | "cloud" | "local_fallback" }>; }
const local: ContentRepository = { knowledge: async () => ({ data: localKnowledge.flatMap((item) => { const parsed = KnowledgeItemSchema.safeParse(item); return parsed.success ? [parsed.data] : []; }), source: "local" }), cases: async () => ({ data: localCases.flatMap((item) => { const parsed = CaseSchema.safeParse(item); return parsed.success ? [parsed.data] : []; }), source: "local" }) };
const cloud: ContentRepository = { knowledge: async () => { const client = await getServerSupabaseClient(); if (!client) return { ...(await local.knowledge()), source: "local_fallback" }; const { data, error } = await client.from("knowledge_entries").select("payload").eq("status", "published").is("deleted_at", null); if (error) return { ...(await local.knowledge()), source: "local_fallback" }; return { data: (data ?? []).flatMap((row) => { const parsed = KnowledgeItemSchema.safeParse(row.payload); return parsed.success ? [parsed.data] : []; }), source: "cloud" }; }, cases: async () => { const client = await getServerSupabaseClient(); if (!client) return { ...(await local.cases()), source: "local_fallback" }; const { data, error } = await client.from("case_entries").select("payload").eq("status", "published").is("deleted_at", null); if (error) return { ...(await local.cases()), source: "local_fallback" }; return { data: (data ?? []).flatMap((row) => { const parsed = CaseSchema.safeParse(row.payload); return parsed.success ? [parsed.data] : []; }), source: "cloud" }; } };
export function contentRepository(): ContentRepository { const config = supabaseConfig(); return config.configured && config.flags.syncEnabled ? cloud : local; }
