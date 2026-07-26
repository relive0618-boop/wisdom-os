import { ContentEditor } from "@/components/admin/ContentEditor";
import { AdminLayout } from "@/components/admin/AdminLayout";
export default function Page() { return <AdminLayout title="新增案例"><p className="mt-5 text-sm">Composite 案例可不填來源；real 案例發布前必須有有效來源。</p><ContentEditor kind="cases" /></AdminLayout>; }
