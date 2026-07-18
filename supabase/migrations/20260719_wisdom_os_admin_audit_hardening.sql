-- Admin content workflow hardening. This migration is additive and does not alter
-- existing content, user reports, PDCA cycles, RLS policies, or table grants.
-- Rollback guidance is documented in docs/v0.4-admin-audit-verification.sql.

create or replace function public.enforce_admin_content_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_actor uuid;
begin
  -- An authenticated caller must be an app_metadata admin. A server-only service
  -- role path must still supply the actor explicitly; browser input is never trusted.
  if auth.role() = 'service_role' then
    trusted_actor := coalesce(new.updated_by, new.created_by);
  elsif public.is_admin() and auth.uid() is not null then
    trusted_actor := auth.uid();
  else
    raise exception using errcode = 'P0001', message = 'content workflow rejected';
  end if;

  if trusted_actor is null then
    raise exception using errcode = 'P0001', message = 'content workflow rejected';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.deleted_at is not null then
      raise exception using errcode = 'P0001', message = 'content workflow rejected';
    end if;
    new.created_by := trusted_actor;
    new.updated_by := trusted_actor;
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if old.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'content workflow rejected';
  end if;

  if new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception using errcode = 'P0001', message = 'content workflow rejected';
  end if;

  -- A soft delete is the only permitted deleted_at mutation and cannot alter
  -- business content or status. A second delete is rejected by the old row check.
  if new.deleted_at is distinct from old.deleted_at then
    if new.deleted_at is null or new.status is distinct from old.status or new.payload is distinct from old.payload then
      raise exception using errcode = 'P0001', message = 'content workflow rejected';
    end if;
  elsif new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status = 'reviewed') or
      (old.status = 'reviewed' and new.status in ('draft', 'published')) or
      (old.status = 'published' and new.status = 'archived') or
      (old.status = 'archived' and new.status = 'draft')
    ) then
      raise exception using errcode = 'P0001', message = 'content workflow rejected';
    end if;

    -- Published and archived records must transition before any payload edit.
    if old.status in ('published', 'archived') and new.payload is distinct from old.payload then
      raise exception using errcode = 'P0001', message = 'content workflow rejected';
    end if;
  elsif old.status not in ('draft', 'reviewed') then
    -- Reject published/archived same-state writes, including no-op requests.
    raise exception using errcode = 'P0001', message = 'content workflow rejected';
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_by := trusted_actor;
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

create or replace function public.audit_admin_content_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
  audit_entity_type text;
  previous_status text;
begin
  audit_entity_type := case tg_table_name
    when 'knowledge_entries' then 'knowledge'
    when 'case_entries' then 'cases'
    else null
  end;
  if audit_entity_type is null or new.updated_by is null then
    raise exception using errcode = 'P0001', message = 'content audit rejected';
  end if;

  if tg_op = 'INSERT' then
    audit_action := 'create';
    previous_status := null;
  elsif old.deleted_at is null and new.deleted_at is not null then
    audit_action := 'soft_delete';
    previous_status := old.status;
  elsif old.status is distinct from new.status then
    audit_action := 'status_transition';
    previous_status := old.status;
  else
    audit_action := 'update';
    previous_status := old.status;
  end if;

  -- This insert is in the same transaction as the content row mutation. Any error
  -- rolls the entire mutation back; metadata deliberately contains no payload.
  insert into public.admin_audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    new.updated_by,
    audit_action,
    audit_entity_type,
    new.id,
    jsonb_strip_nulls(jsonb_build_object(
      'previousStatus', previous_status,
      'nextStatus', new.status,
      'version', new.version
    ))
  );
  return new;
end;
$$;

revoke all on function public.enforce_admin_content_workflow() from public, anon, authenticated, service_role;
revoke all on function public.audit_admin_content_mutation() from public, anon, authenticated, service_role;

drop trigger if exists knowledge_entries_admin_content_workflow on public.knowledge_entries;
create trigger knowledge_entries_admin_content_workflow
before insert or update on public.knowledge_entries
for each row execute function public.enforce_admin_content_workflow();

drop trigger if exists case_entries_admin_content_workflow on public.case_entries;
create trigger case_entries_admin_content_workflow
before insert or update on public.case_entries
for each row execute function public.enforce_admin_content_workflow();

drop trigger if exists knowledge_entries_admin_content_audit on public.knowledge_entries;
create trigger knowledge_entries_admin_content_audit
after insert or update on public.knowledge_entries
for each row execute function public.audit_admin_content_mutation();

drop trigger if exists case_entries_admin_content_audit on public.case_entries;
create trigger case_entries_admin_content_audit
after insert or update on public.case_entries
for each row execute function public.audit_admin_content_mutation();

comment on function public.enforce_admin_content_workflow() is
  'Enforces trusted admin actor, draft-only creates, immutable published/archived payloads, and content revisions.';
comment on function public.audit_admin_content_mutation() is
  'Writes a minimal derived admin audit event in the same transaction as content mutation.';
