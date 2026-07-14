import { createClient } from "@supabase/supabase-js";
import knowledge from "../apps/web/src/lib/knowledge.json" with { type: "json" };
import cases from "../apps/web/src/lib/cases.json" with { type: "json" };
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("SUPABASE_SEED_NOT_CONFIGURED");
const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
await client.from("knowledge_entries").upsert(knowledge.map((payload) => ({ id: payload.id, payload, status: "published" })), { onConflict: "id" });
await client.from("case_entries").upsert(cases.map((payload) => ({ id: payload.id, payload, status: "published" })), { onConflict: "id" });
console.log("Supabase public content seed completed.");
