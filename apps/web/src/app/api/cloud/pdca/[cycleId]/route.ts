import { deleteCloudEntity, saveCloudEntity } from "@/lib/cloud/server";
export async function PUT(request: Request, { params }: { params: Promise<{ cycleId: string }> }) { return saveCloudEntity(request, "pdca", (await params).cycleId); }
export async function DELETE(request: Request, { params }: { params: Promise<{ cycleId: string }> }) { const data = await request.json().catch(() => ({})); return deleteCloudEntity("pdca", (await params).cycleId, typeof data.expectedRevision === "number" ? data.expectedRevision : null); }
