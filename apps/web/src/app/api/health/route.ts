import { NextResponse } from "next/server";
import { HealthResponseSchema } from "@wisdom/shared";
import { publicRemoteConfig } from "@/lib/ai";
import { publicCloudConfig } from "@/lib/supabase/config";

export async function GET() {
  const remote = publicRemoteConfig();
  const cloud = publicCloudConfig();
  return NextResponse.json(HealthResponseSchema.parse({
    ok: true,
    app: "AI Wisdom OS",
    remote,
    cloud: {
      configured: cloud.configured,
      authEnabled: cloud.configured,
      syncEnabled: cloud.configured && cloud.syncEnabled,
      adminEnabled: cloud.configured && cloud.adminEnabled,
      persistentRateLimitEnabled: cloud.configured && cloud.persistentRateLimitEnabled,
      rateLimitBackend: cloud.configured && cloud.persistentRateLimitEnabled ? "supabase" : "memory",
      databaseReachable: null,
    },
    mode: remote.configured ? "remote" : "local",
    defaultMode: "auto",
  }));
}
