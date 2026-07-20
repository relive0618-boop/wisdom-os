-- Read-only verification for 20260720100901_wisdom_os_rate_limit_hardening.sql.
-- This file intentionally returns aggregate counts only and never identifier hashes.

select rowsecurity as rate_limit_rls_enabled
from pg_tables
where schemaname = 'public' and tablename = 'rate_limit_buckets';

select count(*) as raw_ip_column_count
from information_schema.columns
where table_schema = 'public'
  and table_name = 'rate_limit_buckets'
  and column_name in ('raw_ip', 'ip_address', 'ip', 'client_ip', 'forwarded_for');

select p.prosecdef as consume_rate_limit_security_definer,
       coalesce(array_to_string(p.proconfig, ','), '') as consume_rate_limit_search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'consume_rate_limit';

select has_function_privilege('anon', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE') as service_role_execute;

select count(*) as browser_table_grants
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'rate_limit_buckets'
  and grantee in ('anon', 'authenticated');

select count(*) filter (where identifier_hash !~ '^[0-9a-f]{64}$') as malformed_identifier_hash_rows,
       count(*) filter (where route <> '/api/analyze') as unexpected_route_rows,
       count(*) filter (where request_count < 0) as invalid_request_count_rows,
       count(*) as current_bucket_row_count
from public.rate_limit_buckets;

select count(*) as duplicate_identifier_route_rows
from (
  select identifier_hash, route
  from public.rate_limit_buckets
  group by identifier_hash, route
  having count(*) > 1
) duplicates;
