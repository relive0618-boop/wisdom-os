import type { ContentStatus } from "@/lib/admin/contentTransitions";
export function StatusBadge({ status }: { status: ContentStatus }) { return <span className="rounded-full bg-[#eee9df] px-2 py-1 text-xs">{status}</span>; }
