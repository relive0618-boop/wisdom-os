import { SyncResolutionSchema } from "@wisdom/shared";
import { cloudError } from "@/lib/cloud/server";
import { NextResponse } from "next/server";
export async function POST(request: Request) { const body = await request.json().catch(() => null); const parsed = SyncResolutionSchema.safeParse(body); if (!parsed.success) return cloudError("CLOUD_INVALID_INPUT", 422); return NextResponse.json({ resolved: true, strategy: parsed.data.strategy, note: "Resolution requires an explicit client confirmation; local records are never deleted automatically." }); }
