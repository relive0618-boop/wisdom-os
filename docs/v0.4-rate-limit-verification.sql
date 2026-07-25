-- Read-only verification for 20260720100901_wisdom_os_rate_limit_hardening.sql.
-- This file intentionally returns aggregate counts and boolean checks only.
-- It never returns identifier hashes, request payloads, or cron job lists.

select rowsecurity as rate_limit_rls_enabled
from pg_tables
where schemaname = 'public' and tablename = 'rate_limit_buckets';

select count(*) as raw_ip_column_count
from information_schema.columns
where table_schema = 'public'
  and table_name = 'rate_limit_buckets'
  and column_name in ('raw_ip', 'ip_address', 'ip', 'client_ip', 'forwarded_for');

select p.prosecdef as consume_rate_limit_security_definer,
       coalesce(p.proconfig @> array['search_path=pg_catalog, pg_temp'], false) as consume_rate_limit_safe_search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'consume_rate_limit';

select p.prosecdef as prune_rate_limit_security_definer,
       coalesce(p.proconfig @> array['search_path=pg_catalog, pg_temp'], false) as prune_rate_limit_safe_search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'prune_wisdom_rate_limit_buckets';

select has_function_privilege('anon', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE') as anon_consume_execute,
       has_function_privilege('authenticated', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE') as authenticated_consume_execute,
       has_function_privilege('service_role', 'public.consume_rate_limit(text,text,integer,integer)', 'EXECUTE') as service_role_consume_execute,
       has_function_privilege('anon', 'public.prune_wisdom_rate_limit_buckets()', 'EXECUTE') as anon_prune_execute,
       has_function_privilege('authenticated', 'public.prune_wisdom_rate_limit_buckets()', 'EXECUTE') as authenticated_prune_execute,
       has_function_privilege('service_role', 'public.prune_wisdom_rate_limit_buckets()', 'EXECUTE') as service_role_prune_execute;

select count(*) as browser_table_grants
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'rate_limit_buckets'
  and grantee in ('anon', 'authenticated');

select exists (
  select 1
  from pg_extension
  where extname = 'pg_cron'
) as pg_cron_installed;

select count(*) as named_prune_job_count,
       coalesce(bool_and(schedule = '*/5 * * * *'), false) as named_prune_job_has_expected_schedule,
       coalesce(bool_and(command = 'select public.prune_wisdom_rate_limit_buckets();'), false) as named_prune_job_has_expected_command
from cron.job
where jobname = 'wisdom-os-rate-limit-prune';

select exists (
  select 1
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'rate_limit_buckets'
    and indexname = 'rate_limit_buckets_updated_at_idx'
) as updated_at_index_exists;

select count(*) filter (where identifier_hash !~ '^[0-9a-f]{64}$') as malformed_identifier_hash_rows,
       count(*) filter (where route <> '/api/analyze') as unexpected_route_rows,
       count(*) filter (where request_count < 0) as negative_request_count_rows,
       count(*) filter (where request_count > 11) as over_cap_request_count_rows,
       count(*) filter (where updated_at < now() - interval '20 minutes') as stale_bucket_rows_over_twenty_minutes,
       count(*) as current_bucket_row_count
from public.rate_limit_buckets;

select count(*) as duplicate_identifier_route_rows
from (
  select identifier_hash, route
  from public.rate_limit_buckets
  group by identifier_hash, route
  having count(*) > 1
) duplicates;
