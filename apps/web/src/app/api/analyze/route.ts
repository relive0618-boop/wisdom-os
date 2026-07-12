import { NextResponse } from "next/server";
import knowledgeData from "@/lib/knowledge.json" with { type: "json" };
import casesData from "@/lib/cases.json" with { type: "json" };
import { createEngine } from "@/lib/engine.js";

const { retrieve, buildLocalReport } = createEngine(knowledgeData, casesData);

export async function POST(request: Request) {
  const body = await request.json();
  const retrieved = retrieve(body);
  const report = buildLocalReport(body, retrieved);
  return NextResponse.json({ report, retrievedAt: new Date().toISOString() });
}
