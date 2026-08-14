-- Reconciliation note (added 2026-08-14, no re-run against production):
-- Applied directly to production on 2026-07-29, reproduced verbatim from
-- supabase_migrations.schema_migrations.statements. Do not re-apply.

begin;

alter policy "Users can add their books" on public.books
  with check ((select auth.uid()) = user_id);

alter policy "Users can move books to trash" on public.books
  using ((select auth.uid()) = user_id);

alter policy "Users can update their books" on public.books
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "Users can view their books" on public.books
  using ((select auth.uid()) = user_id);

alter policy daily_book_prices_owner_insert on public.daily_book_prices
  with check ((select auth.uid()) = user_id);

alter policy daily_book_prices_owner_select on public.daily_book_prices
  using ((select auth.uid()) = user_id);

alter policy daily_book_prices_owner_update on public.daily_book_prices
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy notification_settings_owner_insert on public.notification_settings
  with check ((select auth.uid()) = user_id);

alter policy notification_settings_owner_select on public.notification_settings
  using ((select auth.uid()) = user_id);

alter policy notification_settings_owner_update on public.notification_settings
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy notifications_owner_insert on public.notifications
  with check ((select auth.uid()) = user_id);

alter policy notifications_owner_select on public.notifications
  using ((select auth.uid()) = user_id);

alter policy notifications_owner_update on public.notifications
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy price_history_owner_insert on public.price_history
  with check ((select auth.uid()) = user_id);

alter policy price_history_owner_select on public.price_history
  using ((select auth.uid()) = user_id);

alter policy price_history_owner_update on public.price_history
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy price_offers_owner_insert on public.price_offers
  with check ((select auth.uid()) = user_id);

alter policy price_offers_owner_select on public.price_offers
  using ((select auth.uid()) = user_id);

alter policy price_offers_owner_update on public.price_offers
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy price_scan_runs_owner_insert on public.price_scan_runs
  with check ((select auth.uid()) = user_id);

alter policy price_scan_runs_owner_select on public.price_scan_runs
  using ((select auth.uid()) = user_id);

alter policy price_scan_runs_owner_update on public.price_scan_runs
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
