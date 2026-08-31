-- Reconciliation note (added 2026-08-23):
-- Applied directly to production via Supabase MCP on 2026-08-23, shortly
-- after 20260823103500_render_server_keep_warm.sql. Documented here for
-- migration history; safe/idempotent to re-run.
--
-- The keep-warm ping's own 15s timeout was too short to observe success
-- on a cold-start wake. First real ping (2026-08-23 10:40 UTC) confirmed
-- the diagnosis directly: DNS (~143ms) and TCP/SSL handshake (~74ms)
-- succeeded, but no HTTP response came back within 15s - net.http_get
-- errored with "Timeout of 15000 ms reached". This is exactly the
-- documented Render free-tier cold-start behavior (render-server/DEPLOY.md
-- says 30-60s to wake), not a connectivity problem.
--
-- Raised to 70s so the keep-warm ping can actually complete and confirm a
-- successful wake instead of timing out on (likely) every cold start. This
-- only affects the keep-warm ping - it does not touch
-- RENDER_SERVER_TIMEOUT_MS (20s, unchanged) used by real scan checks in
-- supabase/functions/alerts/index.ts, which still intentionally fails fast
-- to protect other sources in the same run.

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'render-server-keep-warm';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'render-server-keep-warm',
    '*/10 * * * *',
    $schedule$
      select net.http_get(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'render_server_url'
          limit 1
        ) || '/health',
        timeout_milliseconds := 70000
      );
    $schedule$
  );
end $$;
