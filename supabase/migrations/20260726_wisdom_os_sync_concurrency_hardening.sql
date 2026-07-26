-- Cloud-sync mutations are intentionally funneled through these RPCs.  Browser
-- clients retain SELECT access through RLS, but never receive table-level DML.
-- The functions derive ownership from auth.uid() and compare the supplied
-- revision in the mutation statement itself, so two matching updates cannot
-- both succeed.

create or replace function public.sync_mutate_report(
  operation_input text,
  report_id_input text,
  expected_revision_input bigint,
  payload_input jsonb,
  device_id_input text,
  client_updated_at_input timestamptz
)
returns table(result text, cloud_revision bigint, updated_at timestamptz, deleted_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  mutated_revision bigint;
  mutated_updated_at timestamptz;
  mutated_deleted_at timestamptz;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if operation_input not in ('create', 'update', 'delete')
     or report_id_input is null or length(report_id_input) = 0 then
    raise exception using errcode = '22023', message = 'invalid sync mutation';
  end if;
  if operation_input in ('create', 'update') and (
    payload_input is null
    or payload_input ->> 'reportId' is distinct from report_id_input
    or payload_input #>> '{report,reportId}' is distinct from report_id_input
  ) then
    raise exception using errcode = '22023', message = 'report identifier mismatch';
  end if;
  if operation_input = 'create' and expected_revision_input is not null then
    raise exception using errcode = '22023', message = 'create cannot include revision';
  end if;
  if operation_input in ('update', 'delete') and coalesce(expected_revision_input, 0) < 1 then
    raise exception using errcode = '22023', message = 'revision required';
  end if;

  if operation_input = 'create' then
    insert into public.user_reports as r(
      user_id, report_id, decision_id, title, category, payload, analysis_meta,
      device_id, client_updated_at
    )
    values (
      actor_id,
      report_id_input,
      payload_input ->> 'decisionId',
      left(coalesce(payload_input #>> '{report,problem_summary}', ''), 80),
      left(coalesce(payload_input #>> '{report,category}', ''), 80),
      payload_input,
      jsonb_build_object(
        'provider', payload_input ->> 'provider',
        'analysisMode', payload_input ->> 'analysisMode'
      ),
      device_id_input,
      client_updated_at_input
    )
    on conflict (user_id, report_id) do nothing
    returning r.revision, r.updated_at, r.deleted_at
      into mutated_revision, mutated_updated_at, mutated_deleted_at;

    if found then
      return query select 'created'::text, mutated_revision, mutated_updated_at, mutated_deleted_at;
    else
      return query select 'conflict'::text, r.revision, r.updated_at, r.deleted_at
        from public.user_reports as r
        where r.user_id = actor_id and r.report_id = report_id_input;
    end if;
    return;
  end if;

  if operation_input = 'update' then
    update public.user_reports as r
      set decision_id = payload_input ->> 'decisionId',
          title = left(coalesce(payload_input #>> '{report,problem_summary}', ''), 80),
          category = left(coalesce(payload_input #>> '{report,category}', ''), 80),
          payload = payload_input,
          analysis_meta = jsonb_build_object(
            'provider', payload_input ->> 'provider',
            'analysisMode', payload_input ->> 'analysisMode'
          ),
          device_id = device_id_input,
          client_updated_at = client_updated_at_input
      where r.user_id = actor_id
        and r.report_id = report_id_input
        and r.revision = expected_revision_input
        and r.deleted_at is null
      returning r.revision, r.updated_at, r.deleted_at
        into mutated_revision, mutated_updated_at, mutated_deleted_at;

    if found then
      return query select 'updated'::text, mutated_revision, mutated_updated_at, mutated_deleted_at;
    elsif exists (select 1 from public.user_reports as r where r.user_id = actor_id and r.report_id = report_id_input and r.deleted_at is null) then
      return query select 'conflict'::text, r.revision, r.updated_at, r.deleted_at
        from public.user_reports as r where r.user_id = actor_id and r.report_id = report_id_input;
    else
      return query select 'not_found'::text, null::bigint, null::timestamptz, null::timestamptz;
    end if;
    return;
  end if;

  update public.user_reports as r
    set deleted_at = now(),
        revision = r.revision + 1,
        device_id = device_id_input,
        client_updated_at = client_updated_at_input
    where r.user_id = actor_id
      and r.report_id = report_id_input
      and r.revision = expected_revision_input
      and r.deleted_at is null
    returning r.revision, r.updated_at, r.deleted_at
      into mutated_revision, mutated_updated_at, mutated_deleted_at;
  if found then
    return query select 'deleted'::text, mutated_revision, mutated_updated_at, mutated_deleted_at;
  elsif exists (select 1 from public.user_reports as r where r.user_id = actor_id and r.report_id = report_id_input and r.deleted_at is null) then
    return query select 'conflict'::text, r.revision, r.updated_at, r.deleted_at
      from public.user_reports as r where r.user_id = actor_id and r.report_id = report_id_input;
  else
    return query select 'not_found'::text, null::bigint, null::timestamptz, null::timestamptz;
  end if;
end;
$$;

create or replace function public.sync_mutate_pdca_cycle(
  operation_input text,
  cycle_id_input text,
  expected_revision_input bigint,
  payload_input jsonb,
  device_id_input text,
  client_updated_at_input timestamptz
)
returns table(result text, cloud_revision bigint, updated_at timestamptz, deleted_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  mutated_revision bigint;
  mutated_updated_at timestamptz;
  mutated_deleted_at timestamptz;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if operation_input not in ('create', 'update', 'delete')
     or cycle_id_input is null or length(cycle_id_input) = 0 then
    raise exception using errcode = '22023', message = 'invalid sync mutation';
  end if;
  if operation_input in ('create', 'update') and (
    payload_input is null or payload_input ->> 'cycleId' is distinct from cycle_id_input
  ) then
    raise exception using errcode = '22023', message = 'cycle identifier mismatch';
  end if;
  if operation_input = 'create' and expected_revision_input is not null then
    raise exception using errcode = '22023', message = 'create cannot include revision';
  end if;
  if operation_input in ('update', 'delete') and coalesce(expected_revision_input, 0) < 1 then
    raise exception using errcode = '22023', message = 'revision required';
  end if;

  if operation_input = 'create' then
    insert into public.user_pdca_cycles as c(user_id, cycle_id, report_id, payload, device_id, client_updated_at)
    values (actor_id, cycle_id_input, payload_input ->> 'reportId', payload_input, device_id_input, client_updated_at_input)
    on conflict (user_id, cycle_id) do nothing
    returning c.revision, c.updated_at, c.deleted_at into mutated_revision, mutated_updated_at, mutated_deleted_at;
    if found then
      return query select 'created'::text, mutated_revision, mutated_updated_at, mutated_deleted_at;
    else
      return query select 'conflict'::text, c.revision, c.updated_at, c.deleted_at
        from public.user_pdca_cycles as c where c.user_id = actor_id and c.cycle_id = cycle_id_input;
    end if;
    return;
  end if;

  if operation_input = 'update' then
    update public.user_pdca_cycles as c
      set report_id = payload_input ->> 'reportId', payload = payload_input,
          device_id = device_id_input, client_updated_at = client_updated_at_input
      where c.user_id = actor_id and c.cycle_id = cycle_id_input
        and c.revision = expected_revision_input and c.deleted_at is null
      returning c.revision, c.updated_at, c.deleted_at into mutated_revision, mutated_updated_at, mutated_deleted_at;
    if found then
      return query select 'updated'::text, mutated_revision, mutated_updated_at, mutated_deleted_at;
    elsif exists (select 1 from public.user_pdca_cycles as c where c.user_id = actor_id and c.cycle_id = cycle_id_input and c.deleted_at is null) then
      return query select 'conflict'::text, c.revision, c.updated_at, c.deleted_at
        from public.user_pdca_cycles as c where c.user_id = actor_id and c.cycle_id = cycle_id_input;
    else
      return query select 'not_found'::text, null::bigint, null::timestamptz, null::timestamptz;
    end if;
    return;
  end if;

  update public.user_pdca_cycles as c
    set deleted_at = now(), revision = c.revision + 1,
        device_id = device_id_input, client_updated_at = client_updated_at_input
    where c.user_id = actor_id and c.cycle_id = cycle_id_input
      and c.revision = expected_revision_input and c.deleted_at is null
    returning c.revision, c.updated_at, c.deleted_at into mutated_revision, mutated_updated_at, mutated_deleted_at;
  if found then
    return query select 'deleted'::text, mutated_revision, mutated_updated_at, mutated_deleted_at;
  elsif exists (select 1 from public.user_pdca_cycles as c where c.user_id = actor_id and c.cycle_id = cycle_id_input and c.deleted_at is null) then
    return query select 'conflict'::text, c.revision, c.updated_at, c.deleted_at
      from public.user_pdca_cycles as c where c.user_id = actor_id and c.cycle_id = cycle_id_input;
  else
    return query select 'not_found'::text, null::bigint, null::timestamptz, null::timestamptz;
  end if;
end;
$$;

-- A browser may read only its own rows through RLS.  Mutations are RPC-only.
revoke insert, update, delete on table public.user_reports, public.user_pdca_cycles from authenticated;
grant select on table public.user_reports, public.user_pdca_cycles to authenticated;
revoke all on table public.user_reports, public.user_pdca_cycles from anon;

revoke all on function public.sync_mutate_report(text, text, bigint, jsonb, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.sync_mutate_pdca_cycle(text, text, bigint, jsonb, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.sync_mutate_report(text, text, bigint, jsonb, text, timestamptz) to authenticated;
grant execute on function public.sync_mutate_pdca_cycle(text, text, bigint, jsonb, text, timestamptz) to authenticated;
