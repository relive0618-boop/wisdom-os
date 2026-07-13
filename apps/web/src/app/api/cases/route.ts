import { NextResponse } from "next/server";
import cases from "@/lib/cases.json" with { type: "json" };

export async function GET() {
  return NextResponse.json({
    cases: cases.map((item) => ({
      ...item,
      case_type: "composite",
      source_title: null,
      source_url: null,
      source_date: null,
      review_status: "reviewed",
    })),
  });
}
