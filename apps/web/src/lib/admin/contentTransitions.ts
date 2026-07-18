export const contentStatuses = ["draft", "reviewed", "published", "archived"] as const;
export type ContentStatus = typeof contentStatuses[number];
const transitions: Record<ContentStatus, ContentStatus[]> = {
  draft: ["reviewed"],
  reviewed: ["draft", "published"],
  published: ["archived"],
  archived: ["draft"],
};

export function isContentStatus(value: unknown): value is ContentStatus {
  return typeof value === "string" && contentStatuses.includes(value as ContentStatus);
}

export function canTransition(from: ContentStatus, to: ContentStatus) {
  return transitions[from].includes(to);
}

// Reviewed corrections are part of the current product workflow. Published and archived
// records must move through an allowed transition before their business payload can change.
export function canEdit(status: ContentStatus) {
  return status === "draft" || status === "reviewed";
}

export function canCreateContent(status: ContentStatus) {
  return status === "draft";
}

export function canMutateContent(current: ContentStatus, next: ContentStatus) {
  return current === next ? canEdit(current) : canTransition(current, next);
}
