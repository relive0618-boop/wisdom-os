-- Bounded, server-only rate-limit storage. This migration intentionally touches
-- only rate_limit_buckets and its protected RPC; no business data is changed.
lock table public.rate_limit_buckets in access exclusive mode;

-- Remove malformed legacy buckets, then retain the most recent valid legacy
-- window for each identifier/route pair before collapsing to one row per pair.
delete from public.rate_limit_buckets
where identifier_hash !~ '^[0-9a-f]{64}$'
   or route <> '/api/analyze'
   or request_count < 0;

with ranked as (
  select ctid,
         row_number() over (partition by identifier_hash, route order by window_start desc, updated_at desc) as position
  from public.rate_limit_buckets
)
delete from public.rate_limit_buckets as bucket
using ranked
where bucket.ctid = ranked.ctid
  and ranked.position > 1;

alter table public.rate_limit_buckets
  drop constraint if exists rate_limit_buckets_pkey;

alter table public.rate_limit_buckets
  add constraint rate_limit_buckets_pkey primary key (identifier_hash, route),
  add constraint rate_limit_buckets_identifier_hash_format check (identifier_hash ~ '^[0-9a-f]{64}$'),
  add constraint rate_limit_buckets_route_allowlist check (route = '/api/analyze'),
  add constraint rate_limit_buckets_request_count_nonnegative check (request_count >= 0);

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
        request_count = case
          when public.rate_limit_buckets.window_start = excluded.window_start
            then public.rate_limit_buckets.request_count + 1
          else 1
        end,
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
