import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { claimsUserId, getVerifiedClaims } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const { claims } = await getVerifiedClaims();
  if (!claimsUserId(claims)) redirect("/login?next=/reset-password");
  return <ResetPasswordForm />;
}
