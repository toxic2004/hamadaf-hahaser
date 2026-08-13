begin;

alter table public.notifications
  drop constraint if exists notifications_report_total_up_to_30_check;

alter table public.notifications
  add constraint notifications_report_total_up_to_30_check
  check (
    notification_type not in ('דוח בוקר', 'דוח ערב')
    or not jsonb_path_exists(
      coalesce(metadata -> 'reported_offers', '[]'::jsonb),
      '$[*] ? (!exists(@.total_price) || @.total_price > 30)'
    )
  ) not valid;

comment on constraint notifications_report_total_up_to_30_check
  on public.notifications is
  'דוח בוקר או ערב אינו יכול לכלול הצעה ללא מחיר כולל או מעל 30 ש״ח.';

commit;
