import { NextResponse } from "next/server";
import { HealthResponseSchema } from "@wisdom/shared";
import { remoteConfig } from "@/lib/ai";

export async function GET() {
  const config = remoteConfig();
  const remote = {
    configured: Boolean(config.baseUrl && config.apiKey && config.model),
    baseUrl: config.baseUrl,
    model: config.model,
  };
  return NextResponse.json(HealthResponseSchema.parse({
    ok: true,
    app: "AI Wisdom OS",
    remote,
    mode: remote.configured ? "remote" : "local",
  }));
}
