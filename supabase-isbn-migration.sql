-- Non-destructive migration for ISBN support in "המדף החסר"
-- Run once in the Supabase SQL editor before enabling isbn-module.js.

alter table public.books
  add column if not exists isbn text;

create index if not exists books_user_isbn_idx
  on public.books (user_id, isbn)
  where isbn is not null;

-- Prevent duplicate ISBN values for the same user while allowing null ISBNs.
create unique index if not exists books_user_isbn_unique_idx
  on public.books (user_id, isbn)
  where isbn is not null and isbn <> '';

comment on column public.books.isbn is
  'Normalized ISBN-10 or ISBN-13 value without spaces or hyphens';
