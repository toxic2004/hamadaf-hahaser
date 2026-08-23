-- Reconciliation note (added 2026-08-23):
-- Applied directly to production via Supabase MCP on 2026-08-23. Documented
-- here for migration history; safe/idempotent to re-run.
--
-- Context: investigated why Evrit ("עברית") checks so rarely produce a
-- fully-verified offer. Found RENDER_SERVER_TIMEOUT_MS = 20_000 in
-- supabase/functions/alerts/index.ts (intentionally short, to avoid one
-- slow Evrit check starving the other ~10 sources in a scan run - see the
-- comment there from 2026-08-18). But render-server/DEPLOY.md documents
-- that Render's free tier sleeps after ~15 minutes idle and takes 30-60s
-- to wake on the next request - longer than the 20s the caller allows.
-- Any check that hits a cold render-server is close to guaranteed to fail
-- on timeout, independent of how fast the actual page render would be.
--
-- This does not touch that existing 20s timeout/starvation protection at
-- all. It just pings the render-server's public, unauthenticated /health
-- endpoint every 10 minutes (under the ~15-minute sleep threshold) so it
-- should almost never actually be asleep when a real scan check needs it.
-- Free (Render free tier allows this; no plan change).

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
        timeout_milliseconds := 15000
      );
    $schedule$
  );
end $$;
