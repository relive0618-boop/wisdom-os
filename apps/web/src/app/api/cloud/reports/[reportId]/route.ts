import { deleteCloudEntity, saveCloudEntity } from "@/lib/cloud/server";
export async function PUT(request: Request, { params }: { params: Promise<{ reportId: string }> }) { return saveCloudEntity(request, "reports", (await params).reportId); }
export async function DELETE(request: Request, { params }: { params: Promise<{ reportId: string }> }) { const data = await request.json().catch(() => null); return deleteCloudEntity("reports", (await params).reportId, data); }
