-- Read-only post-deployment verification. Do not run this as a migration.
select schemaname, tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('profiles','user_reports','user_pdca_cycles','knowledge_entries','case_entries','admin_audit_logs','rate_limit_buckets') order by tablename;
select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies where schemaname = 'public' order by tablename, policyname;
select n.nspname as schema, p.proname, p.prosecdef as security_definer, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('is_admin','consume_rate_limit','handle_new_profile','set_wisdom_timestamps_and_revision','set_wisdom_timestamps');
select routine_schema, routine_name, grantee, privilege_type from information_schema.routine_privileges where routine_schema = 'public' and routine_name in ('is_admin','consume_rate_limit') order by routine_name, grantee;
