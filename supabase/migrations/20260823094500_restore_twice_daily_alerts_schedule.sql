-- Reconciliation note (added 2026-08-23):
-- Applied directly to production via Supabase MCP on 2026-08-23. This file
-- documents that change for the migration history; do not re-run manually
-- against production (it is idempotent and safe to re-run, but is committed
-- here purely for record-keeping, matching the pattern of other
-- reconciliation-note migrations in this repo).
--
-- Root cause: cron.job was found completely empty on 2026-08-23. No morning
-- or evening report had run since 2026-08-19 evening (4 days). A single
-- report_runs row from 2026-08-19 (evening, "running") was also found stuck
-- for 4+ days at 64/455 checks - separately marked "failed" via direct SQL,
-- not part of this migration.
--
-- This restores the twice-daily schedule (07:00 / 21:00 Israel Standard
-- Time = 05:00 / 19:00 UTC, matching the exact times that produced
-- successful runs in report_runs history from 2026-08-10 through
-- 2026-08-19). Note: this does not account for Israel Daylight Saving Time
-- (IDT, UTC+3) - during DST the actual local fire time drifts to
-- 08:00/22:00. This matches prior behavior exactly (it was already this way
-- before the schedule disappeared) and is a separate, pre-existing issue,
-- not introduced by this fix.

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
    '0 5 * * *',
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
    '0 19 * * *',
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
