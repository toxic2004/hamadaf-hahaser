-- Reconciliation note (added 2026-08-14, no re-run against production):
-- Applied directly to production on 2026-08-13, reproduced verbatim from
-- supabase_migrations.schema_migrations.statements. Do not re-apply.
--
-- IMPORTANT FOR FUTURE REFERENCE (audit finding, 2026-08-14): this is the
-- migration that made report_runs.status = 'completed' require EVERY
-- automatic-source check for EVERY active book to resolve to exactly
-- 'found' or 'not_found'. Any single check landing on 'blocked',
-- 'login_required', 'manual_required', or leaving pending/temporary_error
-- forever prevents the run from ever completing, and once every check has
-- reached some terminal state without full success the run is marked
-- 'failed' with completed_checks staying at 0. This is very likely the
-- direct cause of the two failed/stuck report runs found during the
-- 2026-08-14 audit (morning 14.08, evening 13.08). This file only
-- documents what already exists in production; changing this behavior is
-- Priority 2 in the fix plan and requires separate explicit approval
-- before any code change.

begin;

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
  automatic_check_count integer;
  successful_check_count integer;
  automatic_terminal_count integer;
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

  select count(distinct checks.book_id)
  into active_book_count
  from public.report_checks checks
  where checks.run_id = target_run
    and checks.user_id = target_user
    and checks.scope_active = true;

  select
    count(*),
    count(*) filter (where checks.status in ('found', 'not_found')),
    count(*) filter (
      where checks.status not in ('pending', 'temporary_error')
    )
  into
    automatic_check_count,
    successful_check_count,
    automatic_terminal_count
  from public.report_checks checks
  join public.report_sources sources on sources.id = checks.source_id
  where checks.run_id = target_run
    and checks.user_id = target_user
    and checks.scope_active = true
    and sources.active = true
    and sources.check_mode = 'authorized_automation';

  select count(*) into covered_book_count
  from (
    select checks.book_id
    from public.report_checks checks
    join public.report_sources sources on sources.id = checks.source_id
    where checks.run_id = target_run
      and checks.user_id = target_user
      and checks.scope_active = true
      and sources.active = true
      and sources.check_mode = 'authorized_automation'
    group by checks.book_id
    having bool_and(checks.status in ('found', 'not_found'))
  ) complete_books;

  update public.report_runs
  set expected_books = active_book_count,
      expected_checks = automatic_check_count,
      completed_checks = successful_check_count,
      full_coverage_books = covered_book_count,
      coverage_percent = case
        when automatic_check_count = 0 then 0
        else round(
          (successful_check_count::numeric / automatic_check_count::numeric) * 100,
          2
        )
      end,
      status = case
        when automatic_check_count > 0
          and successful_check_count = automatic_check_count
          then 'completed'
        when automatic_check_count = 0
          or automatic_terminal_count = automatic_check_count
          then 'failed'
        else 'running'
      end,
      completed_at = case
        when automatic_check_count = 0
          or successful_check_count = automatic_check_count
          or automatic_terminal_count = automatic_check_count
          then coalesce(completed_at, now())
        else null
      end,
      updated_at = now()
  where id = target_run and user_id = target_user;
end;
$$;

comment on function public.sync_report_run_scope(uuid, uuid) is
  'ריצה מושלמת רק כאשר כל בדיקות המקורות האוטומטיים הסתיימו בנמצא או לא נמצא. חסימה, חוסר זמינות או דרישה לבדיקה ידנית מסמנים כישלון ואינם מאפשרים דוח.';

commit;
