alter table public.report_checks
  add column if not exists attempt_count integer not null default 0
    check (attempt_count >= 0),
  add column if not exists search_url text,
  add column if not exists last_error text,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists scope_active boolean not null default true;

update public.report_sources
set check_mode = case
  when id in (
    'simania',
    'evrit',
    'steimatzky',
    'booknet',
    'sipur_hozer',
    'rebooks'
  ) then 'authorized_automation'
  else 'manual'
end;

create index if not exists report_checks_pending_queue_idx
  on public.report_checks (user_id, run_id, next_attempt_at, created_at)
  where scope_active = true
    and status in ('pending', 'temporary_error');

create index if not exists report_runs_processing_queue_idx
  on public.report_runs (user_id, local_date, started_at)
  where status = 'running';

create or replace function public.start_report_run_for_user_on_date(
  target_user uuid,
  target_kind text,
  target_local_date date
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_run uuid;
  book_count integer;
  source_count integer;
begin
  if target_user is null
    or target_kind not in ('morning', 'evening')
    or target_local_date is null
  then
    raise exception 'Invalid report request';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_user::text || ':' || target_local_date::text || ':' || target_kind,
      0
    )
  );

  select id into new_run
  from public.report_runs
  where user_id = target_user
    and local_date = target_local_date
    and report_kind = target_kind
  order by started_at desc
  limit 1;
  if new_run is not null then
    return new_run;
  end if;

  select count(*) into book_count
  from public.books
  where user_id = target_user
    and status not in ('השגתי', 'סל מחזור');

  select count(*) into source_count
  from public.report_sources
  where active = true;

  insert into public.report_runs (
    user_id,
    report_kind,
    local_date,
    expected_books,
    expected_checks
  ) values (
    target_user,
    target_kind,
    target_local_date,
    book_count,
    book_count * source_count
  ) returning id into new_run;

  insert into public.report_checks (
    run_id,
    user_id,
    book_id,
    source_id,
    scope_active
  )
  select new_run, target_user, books.id, sources.id, true
  from public.books books
  cross join public.report_sources sources
  where books.user_id = target_user
    and books.status not in ('השגתי', 'סל מחזור')
    and sources.active = true;

  return new_run;
end;
$$;

create or replace function public.sync_report_run_scope(
  target_run uuid,
  target_user uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  active_book_count integer;
  active_check_count integer;
  finished_count integer;
  covered_book_count integer;
begin
  if target_run is null or target_user is null then
    raise exception 'Invalid report scope request';
  end if;

  if not exists (
    select 1
    from public.report_runs
    where id = target_run and user_id = target_user
  ) then
    raise exception 'Report run not found';
  end if;

  update public.report_checks checks
  set scope_active = exists (
        select 1
        from public.books books
        join public.report_sources sources on sources.id = checks.source_id
        where books.id = checks.book_id
          and books.user_id = target_user
          and books.status not in ('השגתי', 'סל מחזור')
          and sources.active = true
      ),
      updated_at = now()
  where checks.run_id = target_run
    and checks.user_id = target_user;

  insert into public.report_checks (
    run_id,
    user_id,
    book_id,
    source_id,
    scope_active
  )
  select target_run, target_user, books.id, sources.id, true
  from public.books books
  cross join public.report_sources sources
  where books.user_id = target_user
    and books.status not in ('השגתי', 'סל מחזור')
    and sources.active = true
  on conflict (run_id, book_id, source_id)
  do update set scope_active = true, updated_at = now();

  select count(distinct book_id), count(*)
  into active_book_count, active_check_count
  from public.report_checks
  where run_id = target_run
    and user_id = target_user
    and scope_active = true;

  select count(*) filter (
           where status not in ('pending', 'temporary_error')
         )
  into finished_count
  from public.report_checks
  where run_id = target_run
    and user_id = target_user
    and scope_active = true;

  select count(*) into covered_book_count
  from (
    select book_id
    from public.report_checks
    where run_id = target_run
      and user_id = target_user
      and scope_active = true
    group by book_id
    having bool_and(status not in ('pending', 'temporary_error'))
  ) complete_books;

  update public.report_runs
  set expected_books = active_book_count,
      expected_checks = active_check_count,
      completed_checks = finished_count,
      full_coverage_books = covered_book_count,
      coverage_percent = case
        when active_check_count = 0 then 0
        else round(
          (finished_count::numeric / active_check_count::numeric) * 100,
          2
        )
      end,
      status = case
        when active_check_count > 0 and finished_count = active_check_count
          then 'completed'
        else 'running'
      end,
      completed_at = case
        when active_check_count > 0 and finished_count = active_check_count
          then coalesce(completed_at, now())
        else null
      end,
      updated_at = now()
  where id = target_run and user_id = target_user;
end;
$$;

create or replace function public.refresh_report_run(target_run uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_user uuid := (select auth.uid());
begin
  if target_user is null then
    raise exception 'Authentication required';
  end if;
  perform public.sync_report_run_scope(target_run, target_user);
end;
$$;

create or replace function public.apply_report_check_results(
  target_run uuid,
  target_user uuid,
  result_rows jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if target_run is null
    or target_user is null
    or result_rows is null
    or jsonb_typeof(result_rows) <> 'array'
  then
    raise exception 'Invalid report result batch';
  end if;

  update public.report_checks checks
  set status = results.status,
      result_count = greatest(coalesce(results.result_count, 0), 0),
      note = nullif(left(results.note, 1000), ''),
      search_url = nullif(left(results.search_url, 2000), ''),
      last_error = nullif(left(results.last_error, 1000), ''),
      attempt_count = greatest(coalesce(results.attempt_count, 0), 0),
      next_attempt_at = results.next_attempt_at,
      checked_at = case
        when results.status in ('pending', 'temporary_error') then null
        else now()
      end,
      updated_at = now()
  from jsonb_to_recordset(result_rows) as results(
    id uuid,
    status text,
    result_count integer,
    note text,
    search_url text,
    last_error text,
    attempt_count integer,
    next_attempt_at timestamptz
  )
  where checks.id = results.id
    and checks.run_id = target_run
    and checks.user_id = target_user
    and checks.scope_active = true
    and checks.status in ('pending', 'temporary_error')
    and results.status in (
      'found',
      'not_found',
      'login_required',
      'blocked',
      'temporary_error',
      'unavailable',
      'manual_required'
    );

  perform public.sync_report_run_scope(target_run, target_user);
end;
$$;

revoke all on function public.start_report_run_for_user_on_date(uuid, text, date)
  from public, anon, authenticated;
grant execute on function public.start_report_run_for_user_on_date(uuid, text, date)
  to service_role;

revoke all on function public.sync_report_run_scope(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sync_report_run_scope(uuid, uuid)
  to authenticated, service_role;

revoke all on function public.apply_report_check_results(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_report_check_results(uuid, uuid, jsonb)
  to service_role;

revoke all on function public.refresh_report_run(uuid) from public, anon;
grant execute on function public.refresh_report_run(uuid) to authenticated;

create or replace view public.gmail_pending_notifications
with (security_invoker = true)
as
select
  notifications.id,
  notifications.user_id,
  notifications.title,
  notifications.body,
  notifications.notification_type,
  notifications.created_at,
  settings.email_address,
  notifications.metadata
from public.notifications notifications
join public.notification_settings settings
  on settings.user_id = notifications.user_id
where notifications.emailed_at is null
  and settings.email_enabled = true
  and settings.email_address is not null;

revoke all on public.gmail_pending_notifications from public, anon;
grant select on public.gmail_pending_notifications to authenticated, service_role;

create or replace function private.invoke_alerts_hourly()
returns bigint
language plpgsql
set search_path = pg_catalog, public, vault, net
as $$
declare
  request_id bigint;
begin
  select net.http_post(
    url := 'https://mfxhmnzyfhlaiqctchvb.supabase.co/functions/v1/alerts',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-schedule-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'alerts_schedule_secret'
        limit 1
      )
    ),
    body := '{"mode":"schedule"}'::jsonb,
    timeout_milliseconds := 110000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function private.invoke_alerts_hourly()
  from public, anon, authenticated;
