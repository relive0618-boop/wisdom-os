import { NextResponse } from "next/server";
import cases from "@/lib/cases.json" with { type: "json" };

export async function GET() {
  return NextResponse.json({ cases });
}
