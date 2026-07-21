-- שלב 3: דירוג עדיפות ומועדפים
-- מיגרציה לא הרסנית. אינה מוחקת או משנה נתונים קיימים.

alter table public.books
  add column if not exists priority text not null default 'רגילה',
  add column if not exists is_favorite boolean not null default false,
  add column if not exists is_required boolean not null default false;

alter table public.books
  drop constraint if exists books_priority_check;

alter table public.books
  add constraint books_priority_check
  check (priority in ('רגילה', 'גבוהה', 'דחופה'));

create index if not exists books_user_priority_idx
  on public.books (user_id, priority);

create index if not exists books_user_favorite_idx
  on public.books (user_id, is_favorite)
  where is_favorite = true;

comment on column public.books.priority is 'רמת עדיפות: רגילה, גבוהה או דחופה';
comment on column public.books.is_favorite is 'האם הספר מופיע ברשימת המועדפים';
comment on column public.books.is_required is 'האם הספר סומן כספר חובה';
