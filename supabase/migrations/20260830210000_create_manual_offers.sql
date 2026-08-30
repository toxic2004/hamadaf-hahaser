-- רדאר המדף: טבלת הצעות ידניות שמתקבלות מקבוצות פייסבוק וכדומה.
-- טבלה נפרדת לחלוטין מ-price_offers (שם ההצעות מאומתות אוטומטית בדף מוצר).
-- אינה נוגעת ב-books, ב-price_offers, ב-report_runs/report_checks או בכל מנגנון קיים אחר.

create table if not exists public.manual_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  book_id text not null references public.books(id) on delete cascade,
  seller_name text,
  phone text,
  item_price numeric not null check (item_price >= 0),
  shipping_price numeric check (shipping_price is null or shipping_price >= 0),
  pickup_location text,
  source_note text,
  entered_at timestamptz not null default now(),
  status text not null default 'פעילה'
    check (status = any (array['פעילה'::text, 'נקנתה'::text, 'לא רלוונטית'::text])),
  purchased_at timestamptz,
  purchased_price numeric check (purchased_price is null or purchased_price >= 0),
  purchased_from text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.manual_offers is
  'רדאר המדף: הצעות שהוזנו ידנית (מצילומי מסך/טקסט מקבוצות פייסבוק), לא מאומתות אוטומטית. נפרדת לחלוטין מ-price_offers.';
comment on column public.manual_offers.item_price is 'שדה חובה - מחיר הספר כפי שנכתב על ידי המוכר.';
comment on column public.manual_offers.shipping_price is 'נשמר רק אם פורסם במפורש. אין להמציא ערך.';
comment on column public.manual_offers.status is 'פעילה / נקנתה / לא רלוונטית - מנוהל דרך כפתור "קניתי" ותהליך הסינון.';
comment on column public.manual_offers.purchased_price is 'נשמר רק כאשר ההצעה סומנה כנקנתה - מחיר העסקה בפועל.';

create index if not exists manual_offers_book_id_idx
  on public.manual_offers (book_id, entered_at desc);
create index if not exists manual_offers_dup_check_idx
  on public.manual_offers (book_id, seller_name, item_price);
create index if not exists manual_offers_user_id_idx
  on public.manual_offers (user_id);

alter table public.manual_offers enable row level security;

drop policy if exists manual_offers_owner_select on public.manual_offers;
drop policy if exists manual_offers_owner_insert on public.manual_offers;
drop policy if exists manual_offers_owner_update on public.manual_offers;
create policy manual_offers_owner_select
  on public.manual_offers for select to authenticated
  using ((select auth.uid()) = user_id);
create policy manual_offers_owner_insert
  on public.manual_offers for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy manual_offers_owner_update
  on public.manual_offers for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.manual_offers from public, anon, authenticated;
grant select, insert, update on public.manual_offers to authenticated;
grant all on public.manual_offers to service_role;
