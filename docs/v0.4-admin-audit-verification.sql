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

-- Rollback must be a separately approved, maintenance-window operation. Do not run it
-- before investigating audit failures; it only removes the new trigger protection and
-- never deletes content or audit history.
-- drop trigger if exists knowledge_entries_admin_content_audit on public.knowledge_entries;
-- drop trigger if exists case_entries_admin_content_audit on public.case_entries;
-- drop trigger if exists knowledge_entries_admin_content_workflow on public.knowledge_entries;
-- drop trigger if exists case_entries_admin_content_workflow on public.case_entries;
-- drop function if exists public.audit_admin_content_mutation();
-- drop function if exists public.enforce_admin_content_workflow();
