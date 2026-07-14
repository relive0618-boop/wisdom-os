export type CloudFlags = {
  configured: boolean;
  syncEnabled: boolean;
  adminEnabled: boolean;
  persistentRateLimitEnabled: boolean;
};

const enabled = (value: string | undefined) => value === "true";

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || null;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || null;
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() || null;
  return {
    url,
    publishableKey,
    secretKey,
    configured: Boolean(url && publishableKey),
    flags: {
      configured: Boolean(url && publishableKey),
      syncEnabled: enabled(process.env.NEXT_PUBLIC_WISDOM_CLOUD_SYNC_ENABLED),
      adminEnabled: enabled(process.env.NEXT_PUBLIC_WISDOM_ADMIN_ENABLED),
      persistentRateLimitEnabled: enabled(process.env.WISDOM_PERSISTENT_RATE_LIMIT_ENABLED),
    } satisfies CloudFlags,
  };
}

export function publicCloudConfig() {
  const { flags } = supabaseConfig();
  return flags;
}
