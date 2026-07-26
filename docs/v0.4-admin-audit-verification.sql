-- Read-only verification for 20260719_wisdom_os_admin_audit_hardening.sql.
-- Run only after the migration has been deliberately applied to Preview.

select tgrelid::regclass as table_name, tgname as trigger_name, pg_get_triggerdef(oid) as definition
from pg_trigger
where not tgisinternal
  and tgrelid in ('public.knowledge_entries'::regclass, 'public.case_entries'::regclass)
  and tgname like '%admin_content%'
order by table_name, trigger_name;

select n.nspname as schema, p.proname, p.prosecdef as security_definer, p.proconfig as search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('enforce_admin_content_workflow', 'audit_admin_content_mutation')
order by p.proname;

select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('enforce_admin_content_workflow', 'audit_admin_content_mutation')
order by routine_name, grantee;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('knowledge_entries', 'case_entries', 'admin_audit_logs')
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

select count(*) filter (where metadata ? 'payload' or metadata ? 'token' or metadata ? 'secret' or metadata ? 'cookie' or metadata ? 'sql') as unsafe_audit_metadata_rows
from public.admin_audit_logs;

-- The service-only canonical seed path may create only this derived event. It has
-- no actor and no payload metadata; an identical re-run must not create a second event.
select action, actor_id is null as actor_is_null, count(*) as event_count
from public.admin_audit_logs
where action = 'system_seed_create'
group by action, actor_id is null;

select count(*) as invalid_system_actor_events
from public.admin_audit_logs
where actor_id is null
  and action <> 'system_seed_create';

select action, count(*) as unknown_action_count
from public.admin_audit_logs
where action not in ('create', 'update', 'status_transition', 'soft_delete', 'system_seed_create')
group by action;

-- Read-only verification of system ownership/status boundaries. These queries do
-- not expose payloads and do not modify content.
select
  count(*) filter (where status = 'published' and deleted_at is null and created_by is null and updated_by is null) as active_system_rows,
  count(*) filter (where status <> 'published' or deleted_at is not null) as noncanonical_rows
from public.knowledge_entries;

select
  count(*) filter (where status = 'published' and deleted_at is null and created_by is null and updated_by is null) as active_system_rows,
  count(*) filter (where status <> 'published' or deleted_at is not null) as noncanonical_rows
from public.case_entries;

select count(*) filter (where status = 'published' and deleted_at is null) as published_active_count
from public.knowledge_entries;

select count(*) filter (where status = 'published' and deleted_at is null) as published_active_count
from public.case_entries;

-- Rollback must be a separately approved, maintenance-window operation. Do not run it
-- before investigating audit failures; it only removes the new trigger protection and
-- never deletes content or audit history.
-- drop trigger if exists knowledge_entries_admin_content_audit on public.knowledge_entries;
-- drop trigger if exists case_entries_admin_content_audit on public.case_entries;
-- drop trigger if exists knowledge_entries_admin_content_workflow on public.knowledge_entries;
-- drop trigger if exists case_entries_admin_content_workflow on public.case_entries;
-- drop function if exists public.audit_admin_content_mutation();
-- drop function if exists public.enforce_admin_content_workflow();
