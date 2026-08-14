-- Priority-2 fix (2026-08-14, approved by user).
--
-- Problem this fixes: sync_report_run_scope (from strict_report_completion,
-- 2026-08-13) required every single automatic-source check to resolve to
-- exactly 'found' or 'not_found' before a run could reach status =
-- 'completed'. A single check landing on 'blocked', 'login_required', or
-- 'manual_required' - which happens routinely, since sites do sometimes
-- reject a request or a source genuinely needs manual review - permanently
-- prevented the run from completing, and once every check reached some
-- terminal state without 100% success the run was marked 'failed' with
-- completed_checks stuck at 0. Confirmed via the two failed/stuck runs
-- found in the 2026-08-14 audit.
--
-- What changes: a run is now considered "done trying" (status = 'completed')
-- once every automatic-source check has reached ANY terminal state - found,
-- not_found, blocked, login_required, manual_required, unavailable, or any
-- other value that is not 'pending' or 'temporary_error' (those still get
-- retried via the existing MAX_SCAN_ATTEMPTS mechanism, unchanged). This
-- restores the ability for a report to actually be built and sent once
-- scanning has run its course, instead of requiring perfection.
--
-- What stays the same: expected_checks still only counts sources where
-- report_sources.check_mode = 'authorized_automation' (manual/login sources
-- are still excluded, as before). coverage_percent still exists as an
-- internal diagnostic, but is redefined to reflect the real find-rate
-- (found / automatic_check_count), separate from whether the run is done.
-- The report itself is still filtered to complete, verified offers only -
-- this migration does not relax anything about offer validity, price
-- limits, or matching. books is not touched by this migration.

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
  found_check_count integer;
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

  -- automatic_terminal_count now drives completion: "done trying", not
  -- "everything succeeded". found_check_count is kept separately purely
  -- as a diagnostic (coverage_percent), never as a gate.
  select
    count(*),
    count(*) filter (where checks.status = 'found'),
    count(*) filter (
      where checks.status not in ('pending', 'temporary_error')
    )
  into
    automatic_check_count,
    found_check_count,
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
    having bool_and(checks.status not in ('pending', 'temporary_error'))
  ) complete_books;

  update public.report_runs
  set expected_books = active_book_count,
      expected_checks = automatic_check_count,
      completed_checks = automatic_terminal_count,
      full_coverage_books = covered_book_count,
      coverage_percent = case
        when automatic_check_count = 0 then 0
        else round(
          (found_check_count::numeric / automatic_check_count::numeric) * 100,
          2
        )
      end,
      status = case
        when automatic_check_count = 0
          or automatic_terminal_count = automatic_check_count
          then 'completed'
        else 'running'
      end,
      completed_at = case
        when automatic_check_count = 0
          or automatic_terminal_count = automatic_check_count
          then coalesce(completed_at, now())
        else null
      end,
      updated_at = now()
  where id = target_run and user_id = target_user;
end;
$$;

comment on function public.sync_report_run_scope(uuid, uuid) is
  'ריצה מסומנת completed ברגע שכל בדיקות המקורות האוטומטיים הגיעו למצב סופי כלשהו (לאו דווקא נמצא) - לא כאשר כולן מוצאות התאמה. coverage_percent הוא מדד אבחוני בלבד לאחוז ההצלחה, לא תנאי לשליחה.';

commit;
