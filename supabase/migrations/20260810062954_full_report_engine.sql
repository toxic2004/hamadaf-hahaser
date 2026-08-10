create extension if not exists pgcrypto;

create table if not exists public.report_sources (
  id text primary key,
  label text not null unique,
  sort_order smallint not null unique,
  check_mode text not null default 'manual'
    check (check_mode in ('manual', 'authorized_automation')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.report_sources (id, label, sort_order, check_mode)
values
  ('yad2', 'יד2', 1, 'manual'),
  ('simania', 'סימניה', 2, 'manual'),
  ('facebook_marketplace', 'Facebook Marketplace', 3, 'manual'),
  ('facebook_public', 'פוסטים ציבוריים ב Facebook', 4, 'manual'),
  ('evrit', 'עברית', 5, 'manual'),
  ('steimatzky', 'סטימצקי', 6, 'manual'),
  ('booknet', 'צומת ספרים', 7, 'manual'),
  ('sipur_hozer', 'סיפור חוזר', 8, 'manual'),
  ('rebooks', 'Rebooks', 9, 'manual'),
  ('independent_and_general', 'חנויות עצמאיות וחיפוש כללי', 10, 'manual')
on conflict (id) do update
set label = excluded.label,
    sort_order = excluded.sort_order,
    check_mode = excluded.check_mode,
    active = true;

create table if not exists public.report_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_kind text not null check (report_kind in ('morning', 'evening', 'manual')),
  local_date date not null default (timezone('Asia/Jerusalem', now()))::date,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  expected_books integer not null default 0 check (expected_books >= 0),
  expected_checks integer not null default 0 check (expected_checks >= 0),
  completed_checks integer not null default 0 check (completed_checks >= 0),
  full_coverage_books integer not null default 0 check (full_coverage_books >= 0),
  coverage_percent numeric(5, 2) not null default 0
    check (coverage_percent between 0 and 100),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'completed' or completed_checks = expected_checks)
);

create unique index if not exists report_runs_user_day_kind_unique
  on public.report_runs (user_id, local_date, report_kind)
  where report_kind in ('morning', 'evening');

create index if not exists report_runs_user_started_idx
  on public.report_runs (user_id, started_at desc);

create table if not exists public.report_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.report_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null references public.books(id) on delete cascade,
  source_id text not null references public.report_sources(id),
  status text not null default 'pending'
    check (status in (
      'pending',
      'found',
      'not_found',
      'login_required',
      'blocked',
      'temporary_error',
      'unavailable',
      'manual_required'
    )),
  result_count integer not null default 0 check (result_count >= 0),
  note text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, book_id, source_id)
);

create index if not exists report_checks_user_run_status_idx
  on public.report_checks (user_id, run_id, status);

create index if not exists report_checks_book_source_idx
  on public.report_checks (book_id, source_id);

alter table public.report_sources enable row level security;
alter table public.report_runs enable row level security;
alter table public.report_checks enable row level security;

drop policy if exists report_sources_authenticated_select on public.report_sources;
create policy report_sources_authenticated_select
  on public.report_sources for select
  to authenticated
  using (true);

drop policy if exists report_runs_owner_select on public.report_runs;
drop policy if exists report_runs_owner_insert on public.report_runs;
drop policy if exists report_runs_owner_update on public.report_runs;
drop policy if exists report_runs_owner_delete on public.report_runs;
create policy report_runs_owner_select
  on public.report_runs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy report_runs_owner_insert
  on public.report_runs for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy report_runs_owner_update
  on public.report_runs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy report_runs_owner_delete
  on public.report_runs for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists report_checks_owner_select on public.report_checks;
drop policy if exists report_checks_owner_insert on public.report_checks;
drop policy if exists report_checks_owner_update on public.report_checks;
drop policy if exists report_checks_owner_delete on public.report_checks;
create policy report_checks_owner_select
  on public.report_checks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy report_checks_owner_insert
  on public.report_checks for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy report_checks_owner_update
  on public.report_checks for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy report_checks_owner_delete
  on public.report_checks for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.refresh_report_run(target_run uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_user uuid := (select auth.uid());
  expected integer;
  finished integer;
  covered_books integer;
begin
  if target_user is null then
    raise exception 'Authentication required';
  end if;

  select expected_checks into expected
  from public.report_runs
  where id = target_run and user_id = target_user;

  if expected is null then
    raise exception 'Report run not found';
  end if;

  select count(*) filter (where status <> 'pending')
  into finished
  from public.report_checks
  where run_id = target_run and user_id = target_user;

  select count(*) into covered_books
  from (
    select book_id
    from public.report_checks
    where run_id = target_run and user_id = target_user
    group by book_id
    having bool_and(status <> 'pending')
  ) complete_books;

  update public.report_runs
  set completed_checks = finished,
      full_coverage_books = covered_books,
      coverage_percent = case
        when expected = 0 then 0
        else round((finished::numeric / expected::numeric) * 100, 2)
      end,
      status = case when expected > 0 and finished = expected then 'completed' else 'running' end,
      completed_at = case when expected > 0 and finished = expected then coalesce(completed_at, now()) else null end,
      updated_at = now()
  where id = target_run and user_id = target_user;
end;
$$;

create or replace function public.start_report_run(target_kind text default 'manual')
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_user uuid := (select auth.uid());
  new_run uuid;
  book_count integer;
  source_count integer;
begin
  if target_user is null then
    raise exception 'Authentication required';
  end if;
  if target_kind not in ('morning', 'evening', 'manual') then
    raise exception 'Invalid report kind';
  end if;

  if target_kind in ('morning', 'evening') then
    select id into new_run
    from public.report_runs
    where user_id = target_user
      and local_date = (timezone('Asia/Jerusalem', now()))::date
      and report_kind = target_kind
    order by started_at desc
    limit 1;
    if new_run is not null then
      return new_run;
    end if;
  end if;

  select count(*) into book_count
  from public.books
  where user_id = target_user
    and status not in ('השגתי', 'סל מחזור');

  select count(*) into source_count
  from public.report_sources
  where active = true;

  insert into public.report_runs (
    user_id, report_kind, expected_books, expected_checks
  ) values (
    target_user, target_kind, book_count, book_count * source_count
  ) returning id into new_run;

  insert into public.report_checks (run_id, user_id, book_id, source_id)
  select new_run, target_user, books.id, sources.id
  from public.books books
  cross join public.report_sources sources
  where books.user_id = target_user
    and books.status not in ('השגתי', 'סל מחזור')
    and sources.active = true;

  return new_run;
end;
$$;

create or replace function public.start_report_run_for_user(
  target_user uuid,
  target_kind text
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
  if target_user is null or target_kind not in ('morning', 'evening') then
    raise exception 'Invalid report request';
  end if;

  select id into new_run
  from public.report_runs
  where user_id = target_user
    and local_date = (timezone('Asia/Jerusalem', now()))::date
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
    user_id, report_kind, expected_books, expected_checks
  ) values (
    target_user, target_kind, book_count, book_count * source_count
  ) returning id into new_run;

  insert into public.report_checks (run_id, user_id, book_id, source_id)
  select new_run, target_user, books.id, sources.id
  from public.books books
  cross join public.report_sources sources
  where books.user_id = target_user
    and books.status not in ('השגתי', 'סל מחזור')
    and sources.active = true;
  return new_run;
end;
$$;

revoke all on function public.refresh_report_run(uuid) from public, anon;
grant execute on function public.refresh_report_run(uuid) to authenticated;
revoke all on function public.start_report_run(text) from public, anon;
grant execute on function public.start_report_run(text) to authenticated;
revoke all on function public.start_report_run_for_user(uuid, text)
  from public, anon, authenticated;
grant execute on function public.start_report_run_for_user(uuid, text)
  to service_role;

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
  settings.email_address
from public.notifications notifications
join public.notification_settings settings
  on settings.user_id = notifications.user_id
where notifications.emailed_at is null
  and settings.email_enabled = true
  and settings.email_address is not null;

revoke all on public.gmail_pending_notifications from public, anon;
grant select on public.gmail_pending_notifications to authenticated, service_role;

create index if not exists books_user_report_scope_idx
  on public.books (user_id, status, priority, created_at desc);

create index if not exists price_offers_user_book_total_active_idx
  on public.price_offers (user_id, book_id, total_price)
  where active = true and is_removed = false;

drop policy if exists alerts_rate_limits_service_only on public.alerts_rate_limits;
create policy alerts_rate_limits_service_only
  on public.alerts_rate_limits for all to service_role
  using (true) with check (true);

drop policy if exists price_scan_runs_owner_select on public.price_scan_runs;
drop policy if exists price_scan_runs_owner_insert on public.price_scan_runs;
drop policy if exists price_scan_runs_owner_update on public.price_scan_runs;
drop policy if exists price_scan_runs_service_only on public.price_scan_runs;
create policy price_scan_runs_service_only
  on public.price_scan_runs for all to service_role
  using (true) with check (true);

drop policy if exists daily_book_prices_owner_select on public.daily_book_prices;
drop policy if exists daily_book_prices_owner_insert on public.daily_book_prices;
drop policy if exists daily_book_prices_owner_update on public.daily_book_prices;
create policy daily_book_prices_owner_select
  on public.daily_book_prices for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists notification_settings_owner_select on public.notification_settings;
drop policy if exists notification_settings_owner_insert on public.notification_settings;
drop policy if exists notification_settings_owner_update on public.notification_settings;
create policy notification_settings_owner_select
  on public.notification_settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy notification_settings_owner_insert
  on public.notification_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy notification_settings_owner_update
  on public.notification_settings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists notifications_owner_select on public.notifications;
drop policy if exists notifications_owner_insert on public.notifications;
drop policy if exists notifications_owner_update on public.notifications;
create policy notifications_owner_select
  on public.notifications for select to authenticated
  using ((select auth.uid()) = user_id);
create policy notifications_owner_insert
  on public.notifications for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy notifications_owner_update
  on public.notifications for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists price_history_owner_select on public.price_history;
drop policy if exists price_history_owner_insert on public.price_history;
drop policy if exists price_history_owner_update on public.price_history;
create policy price_history_owner_select
  on public.price_history for select to authenticated
  using ((select auth.uid()) = user_id);
create policy price_history_owner_insert
  on public.price_history for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists price_offers_owner_select on public.price_offers;
drop policy if exists price_offers_owner_insert on public.price_offers;
drop policy if exists price_offers_owner_update on public.price_offers;
create policy price_offers_owner_select
  on public.price_offers for select to authenticated
  using ((select auth.uid()) = user_id);
create policy price_offers_owner_insert
  on public.price_offers for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy price_offers_owner_update
  on public.price_offers for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.report_sources, public.report_runs, public.report_checks
  from public, anon;
grant select on public.report_sources to authenticated;
grant select, insert, update, delete on public.report_runs, public.report_checks
  to authenticated;
grant all on public.report_sources, public.report_runs, public.report_checks
  to service_role;

revoke all on public.alerts_rate_limits, public.price_scan_runs,
  public.daily_book_prices, public.notification_settings, public.notifications,
  public.price_history, public.price_offers
  from public, anon, authenticated;

grant select, insert, update on public.notification_settings,
  public.notifications, public.price_offers to authenticated;
grant select, insert on public.price_history to authenticated;
grant select on public.daily_book_prices to authenticated;
grant all on public.alerts_rate_limits, public.price_scan_runs,
  public.daily_book_prices, public.notification_settings, public.notifications,
  public.price_history, public.price_offers to service_role;
