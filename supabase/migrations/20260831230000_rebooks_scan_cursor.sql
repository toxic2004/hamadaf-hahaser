-- מנגנון הדוח האוטומטי: טבלת קורסור לסריקה מלאה של כל הספרים.
--
-- בעיה שתועדה בפרימורטם ותוקנה כאן: rebooks-simple-scan תמיד עשה
-- .order("id").limit(N) בלי קורסור, כך שכל הרצה חוזרת סרקה מחדש רק את
-- אותם N הספרים הראשונים ולעולם לא הגיעה לשאר רשימה של 67-75 ספרים.
--
-- book.id הוא UUID טקסטואלי, לא כרונולוגי - אבל השוואת טקסט עדיין
-- מהווה סדר יציב ודטרמיניסטי, בדיוק מה שנדרש ל-keyset pagination:
-- כל ספר מבוקר פעם אחת בכל מחזור, בלי צורך במשמעות כרונולוגית.

create table if not exists public.rebooks_scan_cursor (
  user_id uuid primary key references auth.users(id),
  last_book_id text,
  updated_at timestamptz not null default now()
);

comment on table public.rebooks_scan_cursor is
  'מנגנון הדוח האוטומטי: מיקום אחרון בסריקת rebooks-simple-scan, לכיסוי מלא ומחזורי של כל הספרים הפעילים במקום חזרה על אותם ספרים בכל הרצה.';

alter table public.rebooks_scan_cursor enable row level security;

revoke all on public.rebooks_scan_cursor from public, anon, authenticated;
grant all on public.rebooks_scan_cursor to service_role;
