import { NextResponse } from "next/server";
import { adminContext, cloudDatabaseError, contentTable } from "@/lib/admin/server";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const context = await adminContext();
  if ("error" in context) return context.error;
  const table = contentTable((await params).kind);
  if (!table) return NextResponse.json({ error: { code: "CLOUD_NOT_FOUND" } }, { status: 404 });

  // Soft-deleted content is intentionally excluded from the default admin list.
  const { data, error } = await context.client.from(table).select("*").is("deleted_at", null).order("updated_at", { ascending: false });
  return error ? cloudDatabaseError(error) : NextResponse.json({ data: data ?? [] });
}
