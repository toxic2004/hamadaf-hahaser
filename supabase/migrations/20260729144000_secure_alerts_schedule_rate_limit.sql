-- הקשחת נקודת הכניסה של מתזמן ההתראות ללא שינוי בנתוני הספרים

create table if not exists public.alerts_rate_limits (
  scope text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.alerts_rate_limits enable row level security;
revoke all on table public.alerts_rate_limits from public, anon, authenticated;

create or replace function public.verify_alerts_schedule_secret(provided_secret text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  secret_valid boolean := false;
  allowed boolean := false;
begin
  select coalesce(
    provided_secret <> '' and provided_secret = (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'alerts_schedule_secret'
      limit 1
    ),
    false
  ) into secret_valid;

  if not secret_valid then
    return false;
  end if;

  insert into public.alerts_rate_limits as rl (
    scope,
    window_started_at,
    request_count,
    updated_at
  ) values (
    'schedule',
    now(),
    1,
    now()
  )
  on conflict (scope) do update set
    window_started_at = case
      when rl.window_started_at <= now() - interval '1 minute' then now()
      else rl.window_started_at
    end,
    request_count = case
      when rl.window_started_at <= now() - interval '1 minute' then 1
      else rl.request_count + 1
    end,
    updated_at = now()
  where
    rl.window_started_at <= now() - interval '1 minute'
    or rl.request_count < 5
  returning true into allowed;

  return coalesce(allowed, false);
end;
$$;

revoke all on function public.verify_alerts_schedule_secret(text)
  from public, anon, authenticated;
grant execute on function public.verify_alerts_schedule_secret(text)
  to service_role;

comment on table public.alerts_rate_limits is
  'Internal rate-limit state for protected Edge Function entry points. Contains no book data.';
comment on function public.verify_alerts_schedule_secret(text) is
  'Validates the internal scheduler secret and allows at most five authorized schedule calls per minute.';
