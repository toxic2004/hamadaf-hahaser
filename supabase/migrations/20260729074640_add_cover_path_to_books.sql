-- Reconciliation note (added 2026-08-14, no re-run against production):
-- Applied directly to production on 2026-07-29, reproduced verbatim from
-- supabase_migrations.schema_migrations.statements. Do not re-apply.

alter table public.books
add column if not exists cover_path text;

comment on column public.books.cover_path is
'Private Supabase Storage object path for a book cover. Existing cover values remain unchanged during gradual migration.';
