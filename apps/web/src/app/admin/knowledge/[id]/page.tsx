import { ContentEditor } from "@/components/admin/ContentEditor";
import { AdminLayout } from "@/components/admin/AdminLayout";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AdminLayout title="編輯知識"><ContentEditor kind="knowledge" contentId={id} /></AdminLayout>; }
