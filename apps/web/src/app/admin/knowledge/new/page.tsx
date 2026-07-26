import { ContentEditor } from "@/components/admin/ContentEditor";
import { AdminLayout } from "@/components/admin/AdminLayout";
export default function Page() { return <AdminLayout title="新增知識"><p className="mt-5 text-sm">先建立草稿，再依序送審與發布。</p><ContentEditor kind="knowledge" /></AdminLayout>; }
