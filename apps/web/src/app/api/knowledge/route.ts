import { NextResponse } from "next/server";
import knowledge from "@/lib/knowledge.json" with { type: "json" };
import chapters from "@/lib/chapters.json" with { type: "json" };

export async function GET() {
  return NextResponse.json({ knowledge, chapters });
}
