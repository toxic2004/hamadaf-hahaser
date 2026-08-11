begin;

create schema if not exists upgrade_backup_20260811;

create table if not exists upgrade_backup_20260811.notifications_old_reports
(like public.notifications including all);

insert into upgrade_backup_20260811.notifications_old_reports
select notifications.*
from public.notifications notifications
where notifications.emailed_at is null
  and notifications.notification_type in ('דוח בוקר', 'דוח ערב')
on conflict (id) do nothing;

delete from public.notifications
where emailed_at is null
  and notification_type in ('דוח בוקר', 'דוח ערב');

alter table public.notification_settings
  alter column email_enabled set default true;

update public.notification_settings
set email_enabled = true,
    morning_report_hour = 7,
    evening_check_hour = 21,
    updated_at = now();

alter table public.notification_settings
  drop constraint if exists notification_settings_email_always_enabled_check;

alter table public.notification_settings
  add constraint notification_settings_email_always_enabled_check
  check (email_enabled = true);

create or replace view public.gmail_pending_notifications
with (security_invoker = true)
as
select
  notifications.id,
  notifications.user_id,
  notifications.title,
  notifications.body,
  notifications.notification_type,
  notifications.created_at,
  settings.email_address,
  notifications.metadata
from public.notifications notifications
join public.notification_settings settings
  on settings.user_id = notifications.user_id
where notifications.emailed_at is null
  and notifications.notification_type in ('דוח בוקר', 'דוח ערב')
  and coalesce(notifications.metadata ->> 'email_html', '') <> ''
  and settings.email_enabled = true
  and settings.email_address is not null;

revoke all on public.gmail_pending_notifications from public, anon;
grant select on public.gmail_pending_notifications to authenticated, service_role;

create or replace function private.mark_bundled_notifications_emailed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.emailed_at is null
    and new.emailed_at is not null
    and new.notification_type in ('דוח בוקר', 'דוח ערב')
  then
    update public.notifications bundled
    set emailed_at = new.emailed_at
    where bundled.user_id = new.user_id
      and bundled.emailed_at is null
      and bundled.notification_type not in ('דוח בוקר', 'דוח ערב')
      and bundled.id in (
        select value::uuid
        from jsonb_array_elements_text(
          coalesce(new.metadata -> 'bundled_notification_ids', '[]'::jsonb)
        ) as ids(value)
      );
  end if;
  return new;
end;
$$;

revoke all on function private.mark_bundled_notifications_emailed() from public;

drop trigger if exists notifications_mark_bundled_emailed
  on public.notifications;

create trigger notifications_mark_bundled_emailed
after update of emailed_at on public.notifications
for each row
execute function private.mark_bundled_notifications_emailed();

commit;
