-- רדאר המדף: תזמון בדיקת "יום שקט", 22:00 שעון ישראל (IDT, UTC+3).
-- Job נפרד לגמרי מ-invoke-alerts-morning/evening - לא נוגע בהם ולא
-- תלוי בהם. משתמש באותו secret ב-Vault (alerts_schedule_secret) כי זו
-- אותה שכבת הרשאה, לא הרחבה של פונקציית ה-alerts עצמה.
--
-- הערה על שעון קיץ/חורף (אותה מגבלה כמו invoke-alerts-morning/evening,
-- ראו 20260823095200_adjust_alerts_schedule_for_israel_dst.sql): 19:00
-- UTC = 22:00 IDT כרגע. כשישראל תצא משעון קיץ (סביב סוף אוקטובר 2026),
-- יהיה צריך לעדכן ל-20:00 UTC כדי להישאר על 22:00 שעון חורף (IST,
-- UTC+2). אין כאן טיפול אוטומטי בשינוי הזה.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'invoke-radar-quiet-check') then
    perform cron.unschedule('invoke-radar-quiet-check');
  end if;

  perform cron.schedule(
    'invoke-radar-quiet-check',
    '0 19 * * *',
    $schedule$
      select net.http_post(
        url := 'https://mfxhmnzyfhlaiqctchvb.supabase.co/functions/v1/radar-quiet-check',
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'x-schedule-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'alerts_schedule_secret'
            limit 1
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    $schedule$
  );
end $$;
