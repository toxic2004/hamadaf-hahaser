-- Reconciliation note (added 2026-08-14, no re-run against production):
-- Applied directly to production on 2026-07-21, reproduced verbatim from
-- supabase_migrations.schema_migrations.statements. Do not re-apply.

grant select on table public.books to service_role;

grant select, insert, update on table
  public.price_offers,
  public.price_history,
  public.daily_book_prices,
  public.notifications,
  public.notification_settings,
  public.price_scan_runs
to service_role;
