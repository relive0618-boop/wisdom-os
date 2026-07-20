import { NextResponse } from "next/server";
import { canCreateContent, canMutateContent, isContentStatus } from "@/lib/admin/contentTransitions";
import { adminContext, cloudDatabaseError, contentTable, parseContent } from "@/lib/admin/server";

const notFound = () => NextResponse.json({ error: { code: "CLOUD_NOT_FOUND" } }, { status: 404 });
const conflict = () => NextResponse.json({ error: { code: "CLOUD_CONFLICT" } }, { status: 409 });
const invalid = () => NextResponse.json({ error: { code: "CLOUD_INVALID_INPUT" } }, { status: 422 });

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const context = await adminContext();
  if ("error" in context) return context.error;
  const table = contentTable(kind);
  if (!table) return notFound();
  const { data, error } = await context.client.from(table)
    .select("id,payload,status,version,created_at,updated_at,created_by,updated_by,deleted_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return cloudDatabaseError(error);
  return data ? NextResponse.json({ data }) : notFound();
}

export async function PUT(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const context = await adminContext();
  if ("error" in context) return context.error;
  const table = contentTable(kind);
  const body = await request.json().catch(() => null);
  if (!table || !body || !isContentStatus(body.status)) return invalid();
  const checked = parseContent(kind, body.payload);
  if (!checked.success || checked.data.id !== id) return invalid();

  const currentResult = await context.client.from(table).select("status").eq("id", id).is("deleted_at", null).maybeSingle();
  if (currentResult.error) return cloudDatabaseError(currentResult.error);

  if (!currentResult.data) {
    if (!canCreateContent(body.status)) return conflict();
    const { error } = await context.client.from(table).insert({
      id,
      payload: checked.data,
      status: body.status,
      created_by: context.userId,
      updated_by: context.userId,
    });
    return error ? cloudDatabaseError(error) : NextResponse.json({ ok: true });
  }

  if (!isContentStatus(currentResult.data.status) || !canMutateContent(currentResult.data.status, body.status)) return conflict();
  const { data, error } = await context.client.from(table)
    .update({ payload: checked.data, status: body.status, updated_by: context.userId })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) return cloudDatabaseError(error);
  return data ? NextResponse.json({ ok: true }) : notFound();
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const context = await adminContext();
  if ("error" in context) return context.error;
  const table = contentTable(kind);
  if (!table) return notFound();

  const currentResult = await context.client.from(table).select("id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (currentResult.error) return cloudDatabaseError(currentResult.error);
  if (!currentResult.data) return notFound();

  const { data, error } = await context.client.from(table)
    .update({ deleted_at: new Date().toISOString(), updated_by: context.userId })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) return cloudDatabaseError(error);
  return data ? new NextResponse(null, { status: 204 }) : notFound();
}
