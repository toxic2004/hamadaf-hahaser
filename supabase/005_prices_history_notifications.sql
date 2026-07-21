-- שלבים 6 עד 8: הצעות מחיר, היסטוריה והתראות
-- מיגרציה לא הרסנית. מוסיפה טבלאות ושדות בלבד.

create table if not exists public.price_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  book_id uuid not null references public.books(id) on delete cascade,
  source text not null,
  source_listing_key text,
  listing_title text,
  seller_name text,
  source_url text,
  ad_image_url text,
  condition text not null default 'יד שנייה',
  match_type text not null default 'מדויקת',
  edition_language text not null default 'עברית',
  location text,
  item_price numeric(10, 2),
  shipping_price numeric(10, 2),
  shipping_known boolean not null default false,
  total_price numeric(10, 2) generated always as (
    case
      when item_price is null or shipping_known = false then null
      else item_price + coalesce(shipping_price, 0)
    end
  ) stored,
  reference_new_price numeric(10, 2),
  deal_score numeric(5, 2),
  deal_explanation text,
  active boolean not null default true,
  is_removed boolean not null default false,
  last_checked_at timestamptz,
  next_check_at timestamptz not null default (now() + interval '2 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_offers_condition_check check (condition in ('חדש', 'יד שנייה')),
  constraint price_offers_match_type_check check (match_type in ('מדויקת', 'דומה', 'לא התאמה')),
  constraint price_offers_language_check check (edition_language in ('עברית', 'אנגלית')),
  constraint price_offers_nonnegative_check check (
    (item_price is null or item_price >= 0)
    and (shipping_price is null or shipping_price >= 0)
    and (reference_new_price is null or reference_new_price >= 0)
  )
);

create unique index if not exists price_offers_user_source_key_unique
  on public.price_offers (user_id, source, source_listing_key)
  where source_listing_key is not null and source_listing_key <> '';
create index if not exists price_offers_book_total_idx
  on public.price_offers (book_id, total_price, active);
create index if not exists price_offers_due_idx
  on public.price_offers (next_check_at)
  where active = true and is_removed = false;

create table if not exists public.price_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  book_id uuid not null references public.books(id) on delete cascade,
  offer_id uuid not null references public.price_offers(id) on delete cascade,
  captured_on date not null default current_date,
  item_price numeric(10, 2),
  shipping_price numeric(10, 2),
  total_price numeric(10, 2),
  source text not null,
  source_url text,
  condition text,
  location text,
  seller_name text,
  ad_image_url text,
  is_removed boolean not null default false,
  paid_price numeric(10, 2),
  created_at timestamptz not null default now(),
  constraint price_history_offer_day_unique unique (offer_id, captured_on)
);

create index if not exists price_history_book_date_idx
  on public.price_history (book_id, captured_on desc);

create table if not exists public.daily_book_prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  book_id uuid not null references public.books(id) on delete cascade,
  offer_id uuid references public.price_offers(id) on delete set null,
  captured_on date not null default current_date,
  item_price numeric(10, 2),
  shipping_price numeric(10, 2),
  total_price numeric(10, 2) not null,
  source text not null,
  source_url text,
  condition text,
  location text,
  seller_name text,
  ad_image_url text,
  paid_price numeric(10, 2),
  created_at timestamptz not null default now(),
  constraint daily_book_prices_book_day_unique unique (book_id, captured_on)
);

create index if not exists daily_book_prices_book_date_idx
  on public.daily_book_prices (book_id, captured_on desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  book_id uuid references public.books(id) on delete cascade,
  offer_id uuid references public.price_offers(id) on delete set null,
  notification_type text not null,
  title text not null,
  body text not null,
  dedupe_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_user_dedupe_unique unique (user_id, dedupe_key)
);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

create table if not exists public.notification_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Jerusalem',
  morning_report_hour smallint not null default 7,
  evening_check_hour smallint not null default 19,
  immediate_deal_threshold numeric(5, 2) not null default 70,
  email_enabled boolean not null default false,
  email_address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_settings_hours_check check (
    morning_report_hour between 0 and 23 and evening_check_hour between 0 and 23
  )
);

create table if not exists public.price_scan_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  local_date date not null,
  run_kind text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  constraint price_scan_runs_kind_check check (run_kind in ('בוקר', 'ערב')),
  constraint price_scan_runs_user_day_kind_unique unique (user_id, local_date, run_kind)
);

alter table public.price_offers enable row level security;
alter table public.price_history enable row level security;
alter table public.daily_book_prices enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_settings enable row level security;
alter table public.price_scan_runs enable row level security;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'price_offers', 'price_history', 'daily_book_prices',
    'notifications', 'notification_settings', 'price_scan_runs'
  ] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = target_table
        and policyname = target_table || '_owner_select'
    ) then
      execute format(
        'create policy %I on public.%I for select using (auth.uid() = user_id)',
        target_table || '_owner_select', target_table
      );
    end if;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = target_table
        and policyname = target_table || '_owner_insert'
    ) then
      execute format(
        'create policy %I on public.%I for insert with check (auth.uid() = user_id)',
        target_table || '_owner_insert', target_table
      );
    end if;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = target_table
        and policyname = target_table || '_owner_update'
    ) then
      execute format(
        'create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)',
        target_table || '_owner_update', target_table
      );
    end if;
  end loop;
end $$;

create or replace function public.capture_price_offer_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.price_history (
    user_id, book_id, offer_id, captured_on, item_price, shipping_price,
    total_price, source, source_url, condition, location, seller_name,
    ad_image_url, is_removed, paid_price
  )
  select
    new.user_id, new.book_id, new.id, (timezone('Asia/Jerusalem', now()))::date, new.item_price,
    new.shipping_price, new.total_price, new.source, new.source_url,
    new.condition, new.location, new.seller_name, new.ad_image_url,
    new.is_removed, books.purchase_price
  from public.books
  where books.id = new.book_id
  on conflict (offer_id, captured_on) do update set
    item_price = excluded.item_price,
    shipping_price = excluded.shipping_price,
    total_price = excluded.total_price,
    source_url = excluded.source_url,
    is_removed = excluded.is_removed,
    paid_price = excluded.paid_price;
  return new;
end $$;

drop trigger if exists price_offers_capture_history on public.price_offers;
create trigger price_offers_capture_history
after insert or update of item_price, shipping_price, shipping_known, active, is_removed, last_checked_at
on public.price_offers
for each row execute function public.capture_price_offer_history();

create or replace function public.snapshot_daily_prices(target_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  insert into public.price_history (
    user_id, book_id, offer_id, captured_on, item_price, shipping_price,
    total_price, source, source_url, condition, location, seller_name,
    ad_image_url, is_removed, paid_price
  )
  select
    offers.user_id, offers.book_id, offers.id, (timezone('Asia/Jerusalem', now()))::date,
    offers.item_price, offers.shipping_price, offers.total_price,
    offers.source, offers.source_url, offers.condition, offers.location,
    offers.seller_name, offers.ad_image_url, offers.is_removed,
    books.purchase_price
  from public.price_offers offers
  join public.books on books.id = offers.book_id
  where target_user is null or offers.user_id = target_user
  on conflict (offer_id, captured_on) do update set
    item_price = excluded.item_price,
    shipping_price = excluded.shipping_price,
    total_price = excluded.total_price,
    is_removed = excluded.is_removed,
    paid_price = excluded.paid_price;

  insert into public.daily_book_prices (
    user_id, book_id, offer_id, captured_on, item_price, shipping_price,
    total_price, source, source_url, condition, location, seller_name,
    ad_image_url, paid_price
  )
  select distinct on (offers.book_id)
    offers.user_id, offers.book_id, offers.id, (timezone('Asia/Jerusalem', now()))::date,
    offers.item_price, offers.shipping_price, offers.total_price,
    offers.source, offers.source_url, offers.condition, offers.location,
    offers.seller_name, offers.ad_image_url, books.purchase_price
  from public.price_offers offers
  join public.books on books.id = offers.book_id
  where offers.active = true
    and offers.is_removed = false
    and offers.total_price is not null
    and (target_user is null or offers.user_id = target_user)
  order by offers.book_id, offers.total_price asc, offers.updated_at desc
  on conflict (book_id, captured_on) do update set
    offer_id = excluded.offer_id,
    item_price = excluded.item_price,
    shipping_price = excluded.shipping_price,
    total_price = excluded.total_price,
    source = excluded.source,
    source_url = excluded.source_url,
    condition = excluded.condition,
    location = excluded.location,
    seller_name = excluded.seller_name,
    ad_image_url = excluded.ad_image_url,
    paid_price = excluded.paid_price;

  get diagnostics affected = row_count;
  return affected;
end $$;

revoke all on function public.snapshot_daily_prices(uuid) from public;
grant execute on function public.snapshot_daily_prices(uuid) to service_role;

comment on table public.price_offers is 'הצעות מחיר חוקיות שנוספו ידנית או דרך חיבור מורשה';
comment on table public.daily_book_prices is 'המחיר הכולל הזול ביותר לכל ספר בכל יום';
comment on table public.notifications is 'התראות בתוך המערכת ומעקב אחר שליחת מייל';
