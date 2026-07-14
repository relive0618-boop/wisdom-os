import { NextResponse } from "next/server";
import { HealthResponseSchema } from "@wisdom/shared";
import { publicRemoteConfig } from "@/lib/ai";

export async function GET() {
  const remote = publicRemoteConfig();
  return NextResponse.json(HealthResponseSchema.parse({
    ok: true,
    app: "AI Wisdom OS",
    remote,
    mode: remote.configured ? "remote" : "local",
    defaultMode: "auto",
  }));
}
