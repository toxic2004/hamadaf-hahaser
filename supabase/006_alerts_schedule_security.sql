-- תזמון מאובטח להתראות, הגדרות משתמש ותיקון הרשאות

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'alerts_schedule_secret'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'alerts_schedule_secret',
      'Secret used only by the internal alerts scheduler'
    );
  end if;
end $$;

create or replace function public.verify_alerts_schedule_secret(provided_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    provided_secret <> '' and provided_secret = (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'alerts_schedule_secret'
      limit 1
    ),
    false
  );
$$;

revoke all on function public.verify_alerts_schedule_secret(text)
  from public, anon, authenticated;
grant execute on function public.verify_alerts_schedule_secret(text)
  to service_role;

revoke all on function public.rls_auto_enable()
  from public, anon, authenticated;

insert into public.notification_settings (
  user_id,
  timezone,
  morning_report_hour,
  evening_check_hour,
  immediate_deal_threshold,
  email_enabled,
  email_address
)
select
  id,
  'Asia/Jerusalem',
  7,
  19,
  70,
  true,
  email
from auth.users
where email = 'toxic2004@gmail.com'
on conflict (user_id) do update set
  timezone = excluded.timezone,
  morning_report_hour = excluded.morning_report_hour,
  evening_check_hour = excluded.evening_check_hour,
  email_enabled = excluded.email_enabled,
  email_address = excluded.email_address,
  updated_at = now();

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'invoke-alerts-hourly';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'invoke-alerts-hourly',
    '0 * * * *',
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
        body := '{"mode":"schedule"}'::jsonb
      );
    $schedule$
  );
end $$;
