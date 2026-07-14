export const contentStatuses = ["draft", "reviewed", "published", "archived"] as const;
export type ContentStatus = typeof contentStatuses[number];
const transitions: Record<ContentStatus, ContentStatus[]> = { draft: ["reviewed"], reviewed: ["draft", "published"], published: ["archived"], archived: ["draft"] };
export function canTransition(from: ContentStatus, to: ContentStatus) { return transitions[from].includes(to); }
export function canEdit(status: ContentStatus) { return status === "draft" || status === "reviewed"; }
