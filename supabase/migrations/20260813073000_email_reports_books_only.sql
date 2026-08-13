begin;

alter table public.notifications
  drop constraint if exists notifications_email_reports_books_only_check;

alter table public.notifications
  add constraint notifications_email_reports_books_only_check
  check (
    notification_type not in ('דוח בוקר', 'דוח ערב')
    or (
      coalesce(metadata ->> 'email_html', '') not ilike '%מספר בדיקות%'
      and coalesce(metadata ->> 'email_html', '') not ilike '%בדיקות הושלמו%'
      and coalesce(metadata ->> 'email_html', '') not ilike '%אחוז כיסוי%'
      and coalesce(metadata ->> 'email_html', '') not ilike '%מקורות חסומים%'
      and coalesce(metadata ->> 'email_html', '') not ilike '%expected_checks%'
      and coalesce(metadata ->> 'email_html', '') not ilike '%completed_checks%'
      and coalesce(metadata ->> 'email_html', '') not ilike '%coverage_percent%'
      and coalesce(metadata ->> 'email_html', '') not ilike '%login_required%'
      and coalesce(metadata ->> 'email_html', '') not ilike '%manual_required%'
    )
  ) not valid;

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
  jsonb_build_object(
    'email_html', notifications.metadata -> 'email_html',
    'reported_offers', coalesce(
      notifications.metadata -> 'reported_offers',
      '[]'::jsonb
    ),
    'bundled_notification_ids', coalesce(
      notifications.metadata -> 'bundled_notification_ids',
      '[]'::jsonb
    ),
    'content_policy', 'books_only_v1'
  ) as metadata
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

comment on view public.gmail_pending_notifications is
  'תור Gmail לדוחות ספרים בלבד. נתוני סריקה טכניים אינם נחשפים לשולח.';

commit;
