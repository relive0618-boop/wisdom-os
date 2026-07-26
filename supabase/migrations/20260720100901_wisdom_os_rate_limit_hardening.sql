-- Bounded, server-only rate-limit storage. This migration intentionally touches
-- only rate_limit_buckets and its protected RPC; no business data is changed.
create extension if not exists pg_cron;

-- Supabase's migration runner does not provide a usable top-level transaction
-- for a bare LOCK TABLE. A DO block runs as one implicit transaction, keeping
-- the legacy-data convergence and key change atomic without BEGIN/COMMIT.
do $$
begin
  lock table public.rate_limit_buckets in access exclusive mode;

  -- Remove malformed legacy buckets, then retain the most recent valid legacy
  -- window for each identifier/route pair before collapsing to one row per pair.
  delete from public.rate_limit_buckets
  where identifier_hash !~ '^[0-9a-f]{64}$'
     or route <> '/api/analyze'
     or request_count < 0;

  -- Clamp pre-existing rows before installing the bounded counter constraint.
  update public.rate_limit_buckets
  set request_count = 11
  where request_count > 11;

  with ranked as (
    select ctid,
           row_number() over (partition by identifier_hash, route order by window_start desc, updated_at desc) as position
    from public.rate_limit_buckets
  )
  delete from public.rate_limit_buckets as bucket
  using ranked
  where bucket.ctid = ranked.ctid
    and ranked.position > 1;

  -- Expire abandoned identifier/route pairs during the convergence migration.
  delete from public.rate_limit_buckets
  where updated_at < now() - interval '15 minutes';

  alter table public.rate_limit_buckets
    drop constraint if exists rate_limit_buckets_pkey;

  alter table public.rate_limit_buckets
    drop constraint if exists rate_limit_buckets_request_count_nonnegative,
    add constraint rate_limit_buckets_pkey primary key (identifier_hash, route),
    add constraint rate_limit_buckets_identifier_hash_format check (identifier_hash ~ '^[0-9a-f]{64}$'),
    add constraint rate_limit_buckets_route_allowlist check (route = '/api/analyze'),
    add constraint rate_limit_buckets_request_count_range check (request_count between 0 and 11);
end;
$$;

create index if not exists rate_limit_buckets_updated_at_idx
  on public.rate_limit_buckets(updated_at);

create or replace function public.consume_rate_limit(identifier_hash_input text, route_name text, limit_count integer, window_seconds integer)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  current_window timestamptz := date_trunc('minute', now());
  current_count integer;
  stored_window timestamptz;
begin
  if identifier_hash_input is null
     or identifier_hash_input !~ '^[0-9a-f]{64}$'
     or route_name <> '/api/analyze'
     or limit_count <> 10
     or window_seconds <> 60 then
    raise exception using errcode = '22023', message = 'invalid rate limit input';
  end if;

  insert into public.rate_limit_buckets(identifier_hash, route, window_start, request_count)
  values (identifier_hash_input, route_name, current_window, 1)
  on conflict (identifier_hash, route) do update
    set window_start = excluded.window_start,
        request_count = least(
          case
            when public.rate_limit_buckets.window_start = excluded.window_start
              then public.rate_limit_buckets.request_count + 1
            else 1
          end,
          11
        ),
        updated_at = now()
  returning request_count, window_start into current_count, stored_window;

  return query
  select current_count <= limit_count,
         greatest(limit_count - current_count, 0),
         stored_window + make_interval(secs => window_seconds);
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;

create or replace function public.prune_wisdom_rate_limit_buckets()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  removed_count bigint;
begin
  delete from public.rate_limit_buckets
  where updated_at < now() - interval '15 minutes';

  get diagnostics removed_count = row_count;
  return removed_count;
end;
$$;

revoke all on function public.prune_wisdom_rate_limit_buckets() from public, anon, authenticated, service_role;

-- The migration may be replayed only in controlled environments. Remove only a
-- prior job with this exact name before scheduling its single canonical command.
do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid
    from cron.job
    where jobname = 'wisdom-os-rate-limit-prune'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'wisdom-os-rate-limit-prune',
    '*/5 * * * *',
    'select public.prune_wisdom_rate_limit_buckets();'
  );
end;
$$;
