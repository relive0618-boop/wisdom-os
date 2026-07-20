import { NextResponse } from "next/server";
import { contentRepository } from "@/lib/contentRepository";
import chapters from "@/lib/chapters.json" with { type: "json" };

export async function GET() {
  const result = await contentRepository().knowledge();
  return NextResponse.json({ knowledge: result.data, chapters, source: result.source });
}
