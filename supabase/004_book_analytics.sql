-- שלב 4: נתונים דרושים לסטטיסטיקות אמינות
-- מיגרציה לא הרסנית. אינה מוחקת נתונים קיימים.

alter table public.books
  add column if not exists acquired_at timestamptz,
  add column if not exists purchase_price numeric(10, 2),
  add column if not exists new_price numeric(10, 2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'books_purchase_price_nonnegative'
      and conrelid = 'public.books'::regclass
  ) then
    alter table public.books
      add constraint books_purchase_price_nonnegative
      check (purchase_price is null or purchase_price >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'books_new_price_nonnegative'
      and conrelid = 'public.books'::regclass
  ) then
    alter table public.books
      add constraint books_new_price_nonnegative
      check (new_price is null or new_price >= 0);
  end if;
end $$;

create index if not exists books_user_acquired_at_idx
  on public.books (user_id, acquired_at desc)
  where acquired_at is not null;

comment on column public.books.acquired_at is 'מועד השגת הספר. ריק כאשר המועד אינו ידוע';
comment on column public.books.purchase_price is 'המחיר ששולם בפועל בשקלים';
comment on column public.books.new_price is 'מחיר ספר חדש להשוואת חיסכון';
