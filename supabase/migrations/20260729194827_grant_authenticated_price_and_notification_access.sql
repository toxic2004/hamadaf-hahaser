-- Reconciliation note (added 2026-08-14, no re-run against production):
-- Applied directly to production on 2026-07-29, reproduced verbatim from
-- supabase_migrations.schema_migrations.statements. Do not re-apply.

grant select, insert, update on table public.price_offers to authenticated;
grant select, insert, update on table public.price_history to authenticated;
grant select, insert, update on table public.notification_settings to authenticated;
grant select, insert, update on table public.notifications to authenticated;
