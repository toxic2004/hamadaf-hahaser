-- Reconciliation note (added 2026-08-14, no re-run against production):
-- Applied directly to production on 2026-07-29, reproduced verbatim from
-- supabase_migrations.schema_migrations.statements. Do not re-apply.

create index if not exists daily_book_prices_offer_id_idx
  on public.daily_book_prices (offer_id);

create index if not exists daily_book_prices_user_id_idx
  on public.daily_book_prices (user_id);

create index if not exists notifications_book_id_idx
  on public.notifications (book_id);

create index if not exists notifications_offer_id_idx
  on public.notifications (offer_id);

create index if not exists price_history_user_id_idx
  on public.price_history (user_id);
