import { NextResponse } from "next/server";
import { contentRepository } from "@/lib/contentRepository";

export async function GET() {
  const result = await contentRepository().cases();
  return NextResponse.json({ cases: result.data, source: result.source });
}
