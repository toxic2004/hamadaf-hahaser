-- רדאר המדף: "✕ לא רלוונטי" - דחייה ידנית של הצעה בודדת, עם שחזור
-- אפשרי, ומחיקה אוטומטית אחרי 30 יום מרגע הדחייה.
--
-- חשוב: זה נפרד לחלוטין מהסטטוס 'לא רלוונטית' הקיים, שמסומן אוטומטית
-- על ידי mark_manual_offer_purchased() כששאר ההצעות לספר שנקנה נסגרות.
-- לפי בקשת המשתמש במפורש - רק דחייה ידנית (הסטטוס החדש 'נדחתה')
-- נכנסת לטיימר של 30 יום; הצעות שהפכו ללא-רלוונטיות אוטומטית בגלל
-- קנייה אינן נמחקות אוטומטית ולא זזות מהמקום שהן כבר מוצגות בו.

alter table public.manual_offers add column if not exists dismissed_at timestamptz;

alter table public.manual_offers drop constraint manual_offers_status_check;
alter table public.manual_offers add constraint manual_offers_status_check
  check (status = any (array['פעילה'::text, 'נקנתה'::text, 'לא רלוונטית'::text, 'נדחתה'::text]));

comment on column public.manual_offers.dismissed_at is
  'רדאר המדף: מתי ההצעה נדחתה ידנית דרך כפתור "לא רלוונטי". רק דחייה ידנית מקבלת ערך כאן - הצעות שהפכו ללא-רלוונטיות אוטומטית (כשנקנה הספר) לא. משמש למחיקה אוטומטית אחרי 30 יום.';

-- Job נפרד לגמרי מכל התזמונים הקיימים (alerts, radar-quiet-check) - לא
-- קורא לאף Edge Function, רק מחיקת SQL ישירה, פעם ביום בשעה שקטה.
select cron.schedule(
  'cleanup-dismissed-manual-offers',
  '0 2 * * *',
  $$
    delete from public.manual_offers
    where status = 'נדחתה' and dismissed_at < now() - interval '30 days';
  $$
);
