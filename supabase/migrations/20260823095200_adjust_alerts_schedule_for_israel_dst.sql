-- Reconciliation note (added 2026-08-23):
-- Applied directly to production via Supabase MCP on 2026-08-23, right
-- after 20260823094500_restore_twice_daily_alerts_schedule.sql. Documented
-- here for migration history; safe/idempotent to re-run.
--
-- Adjusts the twice-daily alerts schedule to fire at exactly 07:00/21:00
-- Israel local time during Daylight Saving Time (IDT, UTC+3, roughly late
-- March to late October). Was 05:00/19:00 UTC (correct for Israel Standard
-- Time, UTC+2) - during IDT that fires at 08:00/22:00 local instead of
-- 07:00/21:00.
--
-- Note: runIsDue() in supabase/functions/alerts/index.ts gates on
-- `localHour >= dueHour`, not exact equality - so no report was ever
-- actually missed by this drift, only delayed by up to an hour during DST.
-- This migration removes that delay; it does not fix a correctness bug.
--
-- Known limitation: this will need to shift back to 05:00/19:00 UTC when
-- Israel exits DST (~late October 2026), or reports will fire an hour
-- early (06:00/20:00 local) instead of on time. No automatic DST-handling
-- was built here - see docs/2026-08-23-cron-schedule-incident.md.

do $$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job where jobname in ('invoke-alerts-morning', 'invoke-alerts-evening')
  loop
    perform cron.unschedule(existing_job);
  end loop;

  perform cron.schedule(
    'invoke-alerts-morning',
    '0 4 * * *',
    $schedule$
      select net.http_post(
        url := 'https://mfxhmnzyfhlaiqctchvb.supabase.co/functions/v1/alerts',
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'x-schedule-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'alerts_schedule_secret'
            limit 1
          )
        ),
        body := '{"mode":"schedule"}'::jsonb,
        timeout_milliseconds := 110000
      );
    $schedule$
  );

  perform cron.schedule(
    'invoke-alerts-evening',
    '0 18 * * *',
    $schedule$
      select net.http_post(
        url := 'https://mfxhmnzyfhlaiqctchvb.supabase.co/functions/v1/alerts',
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'x-schedule-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'alerts_schedule_secret'
            limit 1
          )
        ),
        body := '{"mode":"schedule"}'::jsonb,
        timeout_milliseconds := 110000
      );
    $schedule$
  );
end $$;
