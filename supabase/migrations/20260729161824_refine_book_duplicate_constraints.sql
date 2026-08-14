-- Reconciliation note (added 2026-08-14, no re-run against production):
-- Applied directly to production on 2026-07-29, reproduced verbatim from
-- supabase_migrations.schema_migrations.statements. Do not re-apply.

drop index if exists public.books_unique_title_per_user;

create unique index if not exists books_unique_title_author_per_user
on public.books (
  user_id,
  lower(btrim(title)),
  lower(btrim(coalesce(author, '')))
);
