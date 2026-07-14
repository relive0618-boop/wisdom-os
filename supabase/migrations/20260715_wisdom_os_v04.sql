create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  report_id text not null, decision_id text not null, title text, category text, payload jsonb not null, analysis_meta jsonb,
  revision bigint not null default 1, device_id text, client_updated_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique(user_id, report_id)
);

create table if not exists public.user_pdca_cycles (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  cycle_id text not null, report_id text not null, payload jsonb not null, revision bigint not null default 1, device_id text, client_updated_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique(user_id, cycle_id)
);

create table if not exists public.knowledge_entries (
  id text primary key, payload jsonb not null, status text not null check (status in ('draft','reviewed','published','archived')), version bigint not null default 1,
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table if not exists public.case_entries (like public.knowledge_entries including all);
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id), action text not null, entity_type text not null, entity_id text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.rate_limit_buckets (
  identifier_hash text not null, route text not null, window_start timestamptz not null, request_count integer not null default 0, updated_at timestamptz not null default now(),
  primary key(identifier_hash, route, window_start)
);

alter table public.profiles enable row level security;
alter table public.user_reports enable row level security;
alter table public.user_pdca_cycles enable row level security;
alter table public.knowledge_entries enable row level security;
alter table public.case_entries enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.rate_limit_buckets enable row level security;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.set_wisdom_timestamps_and_revision() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.created_at = coalesce(new.created_at, now()); end if;
  new.updated_at = now();
  if tg_op = 'UPDATE' and new.payload is distinct from old.payload then new.revision = old.revision + 1; end if;
  return new;
end;
$$;
create or replace function public.set_wisdom_timestamps() returns trigger language plpgsql security invoker set search_path = '' as $$ begin new.updated_at = now(); return new; end; $$;
create or replace function public.handle_new_profile() returns trigger language plpgsql security definer set search_path = '' as $$ begin insert into public.profiles(id) values(new.id) on conflict (id) do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_profile();

drop trigger if exists user_reports_revision on public.user_reports;
create trigger user_reports_revision before insert or update on public.user_reports for each row execute function public.set_wisdom_timestamps_and_revision();
drop trigger if exists user_pdca_cycles_revision on public.user_pdca_cycles;
create trigger user_pdca_cycles_revision before insert or update on public.user_pdca_cycles for each row execute function public.set_wisdom_timestamps_and_revision();
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_wisdom_timestamps();
drop trigger if exists knowledge_entries_updated_at on public.knowledge_entries;
create trigger knowledge_entries_updated_at before update on public.knowledge_entries for each row execute function public.set_wisdom_timestamps();
drop trigger if exists case_entries_updated_at on public.case_entries;
create trigger case_entries_updated_at before update on public.case_entries for each row execute function public.set_wisdom_timestamps();

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "reports_own" on public.user_reports;
drop policy if exists "pdca_own" on public.user_pdca_cycles;
drop policy if exists "knowledge_public_published" on public.knowledge_entries;
drop policy if exists "knowledge_admin_all" on public.knowledge_entries;
drop policy if exists "cases_public_published" on public.case_entries;
drop policy if exists "cases_admin_all" on public.case_entries;
drop policy if exists "audit_admin_select" on public.admin_audit_logs;
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "reports_own" on public.user_reports for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "pdca_own" on public.user_pdca_cycles for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "knowledge_public_published" on public.knowledge_entries for select to anon, authenticated using (status = 'published' and deleted_at is null);
create policy "knowledge_admin_all" on public.knowledge_entries for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "cases_public_published" on public.case_entries for select to anon, authenticated using (status = 'published' and deleted_at is null);
create policy "cases_admin_all" on public.case_entries for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "audit_admin_select" on public.admin_audit_logs for select to authenticated using ((select public.is_admin()));

revoke all on public.rate_limit_buckets from anon, authenticated;
create or replace function public.consume_rate_limit(identifier_hash_input text, route_name text, limit_count integer, window_seconds integer)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare bucket timestamptz := date_trunc('minute', now()); current_count integer;
begin
  if identifier_hash_input is null or route_name is null or limit_count < 1 or window_seconds < 1 then raise exception 'invalid rate limit input'; end if;
  insert into public.rate_limit_buckets(identifier_hash, route, window_start, request_count)
  values(identifier_hash_input, route_name, bucket, 1)
  on conflict(identifier_hash, route, window_start) do update set request_count = public.rate_limit_buckets.request_count + 1, updated_at = now()
  returning request_count into current_count;
  return query select current_count <= limit_count, greatest(limit_count - current_count, 0), bucket + make_interval(secs => window_seconds);
end;
$$;
revoke all on function public.consume_rate_limit(text, text, integer, integer) from public;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;
