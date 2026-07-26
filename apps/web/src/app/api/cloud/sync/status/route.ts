import { cloudContext } from "@/lib/cloud/server";
import { NextResponse } from "next/server";
export async function GET() { const context = await cloudContext(); if ("error" in context) return context.error; return NextResponse.json({ state: "idle", automaticUpload: false, batchSize: 25 }); }
