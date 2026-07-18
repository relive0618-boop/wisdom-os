const auditActions = new Set(["create", "update", "status_transition", "soft_delete"]);
const auditEntityTypes = new Set(["knowledge", "cases"]);

export type AuditQuery = {
  offset: number;
  limit: number;
  action: string | null;
  entityType: string | null;
};

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (value === null) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function parseAuditQuery(query: URLSearchParams): AuditQuery | null {
  const offset = boundedInteger(query.get("offset"), 0, 0, 10_000);
  const limit = boundedInteger(query.get("limit"), 50, 1, 100);
  const action = query.get("action");
  const entityType = query.get("entity_type");
  if (offset === null || limit === null) return null;
  if (action !== null && !auditActions.has(action)) return null;
  if (entityType !== null && !auditEntityTypes.has(entityType)) return null;
  return { offset, limit, action, entityType };
}
