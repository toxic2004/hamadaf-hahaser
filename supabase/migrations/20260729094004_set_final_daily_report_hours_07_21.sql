-- Reconciliation note (added 2026-08-14, no re-run against production):
-- Applied directly to production on 2026-07-29, reproduced verbatim from
-- supabase_migrations.schema_migrations.statements. Do not re-apply.
-- This is what changed the evening report hour from 19:00 (set by
-- alerts_schedule_security) to the final 21:00.

alter table public.notification_settings
  alter column morning_report_hour set default 7,
  alter column evening_check_hour set default 21;

update public.notification_settings
set morning_report_hour = 7,
    evening_check_hour = 21
where morning_report_hour is distinct from 7
   or evening_check_hour is distinct from 21;
