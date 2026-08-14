# אודיט מלא + הצעת תיקונים — 14.08.2026

מסמך ייחוס למעקב אחר האודיט שבוצע ב-14.08.2026 והצעת התיקונים שנגזרה ממנו.
**סטטוס: שום תיקון מהמסמך הזה עדיין לא בוצע.** זהו מסמך תכנון בלבד, ממתין לאישור מפורש של המשתמש סעיף-אחר-סעיף.

קרא את המסמך הזה בתחילת כל שיחה עתידית שממשיכה את הפרויקט, לפני שמתחילים לעבוד.

---

## 1. מקורות שאומתו ישירות (לא רק לפי מסמכים)

- **GitHub**: `toxic2004/hamadaf-hahaser`, ענף `main`, HEAD מאומת: `fda7c044f42f97ff1142c417c82e759082f0d508`.
- **Supabase**: project ref `mfxhmnzyfhlaiqctchvb`, סטטוס `ACTIVE_HEALTHY`.
- ספרים: 97 סה"כ / 67 "מחפש" / 26 "השגתי" / 4 "סל מחזור" — מאומת חי מול הטבלה.
- Storage: bucket `book-covers`, פרטי, 81 objects.
- Edge Functions: `alerts` v19 (`verify_jwt=false`), `recognize-book-cover` v1 (`verify_jwt=true`).
- נקרא: כל 283 ה-commits בכל הענפים, כל 21 המיגרציות שרצות בפועל ב-production, כל 3 קבצי `supabase/functions/alerts/*`, `app.js`, `safe-app-loader.js`, `manual-import.js`, מבנה `tests/` (15 קבצים).

## 2. ממצא קריטי: פער בין production לגיט

ב-production רצות **21 מיגרציות**. בתיקיית `supabase/migrations/` בגיט יש **8 קבצים בלבד**. 13 מיגרציות קיימות ורצות בפועל אך **אין להן קובץ בגיט**, כולל:
- `optimize_rls_auth_uid_initplan`, `add_missing_foreign_key_indexes` — בוצעו בפועל (אומתו מול production), אבל לא מתועדות.
- `create_private_book_covers_bucket`, `add_cover_path_to_books`
- `set_final_daily_report_hours_07_21`
- `grant_authenticated_price_and_notification_access`, `grant_authenticated_daily_book_prices`
- **`strict_report_completion`** (13.08, המיגרציה האחרונה ביותר בפרודקשן) — משנה את אופן חישוב `expected_checks` (402 = 67 ספרים × 6 מקורות אוטומטיים בלבד) לעומת מה שכתוב בגיט (670 = 67 × כל 10 המקורות). זה מסביר את הפער שנצפה בין ריצות דוח ישנות (670) לחדשות (402).

בנוסף: `supabase/functions/recognize-book-cover` **קיימת ורצה ב-production (v1) אך אין לה שום קובץ קוד בגיט**. אם היא תישבר, אין ממה לשחזר אותה.

**המשמעות**: אי אפשר כרגע לשחזר את מבנה ה-production מגיט בלבד.

## 3. תיקון לטעות קודמת שלי

באודיט הראשוני טענתי שבאג ה-auto-import מ-`localStorage` (סיכון גבוה לפי דוח ChatGPT) לא תוקן. **זו הייתה טעות** — קראתי רק את `app.js` בבידוד. בפועל `index.html` טוען את `safe-app-loader.js`, שמבצע string-patch על `app.js` ב-runtime (מחליף את `init`/`connected`/`loadRemote`) ומזריק גרסה בטוחה שמציגה מודל אישור מפורש (`manual-import.js` / `HamadafManualImport.promptAndImport`) לפני ייבוא מקומי. **התיקון קיים ופעיל.**

אזהרה: הארכיטקטורה הזו (string-replace על טקסט קוד ב-runtime) שברירית — עריכה עתידית של `app.js` עלולה לשבור את ההתאמה. היא נכשלת "סגור" (מציגה שגיאה למשתמש) ולא "פתוח" (לא חוזרת בשקט להתנהגות הישנה המסוכנת) — אז לפחות זה בטוח, אבל צריך תשומת לב.

## 4. מנגנון הסריקה (`scanner-core.mjs`)

- `SOURCE_PLANS`: יד2 + "חנויות עצמאיות/חיפוש כללי" = `manual` (בכוונה, לא מנסה בכלל). Facebook (שניהם) = `login` (בכוונה). סימניה/עברית/סטימצקי/צומת ספרים/סיפור חוזר/Rebooks = `automatic` (מנסה `fetch()` אמיתי).
- ל-Rebooks/סיפור חוזר יש parser ייעודי (`extractSourceOffers`) שמחלץ כרטיסי מוצר אמיתיים מ-HTML של WooCommerce, בודק מלאי, מוצא מחיר, ומוודא התאמת כותרת מדויקת. זה בדיוק מה שיצר את ההצעה התקינה היחידה שקיימת כרגע (`price_offers`).
- **חשד עיקרי לכישלון הרוחבי**: ה-`fetch` באינדקס (`supabase/functions/alerts/index.ts`) שולח `user-agent: "HamadafHahaserReportBot/1.0 (+read-only availability check)"` — מזדהה כבוט בגלוי. סביר שזו הסיבה המרכזית לתגובות `blocked`/CAPTCHA מהאתרים. **זו השערה, לא הוכחה** — לא נלכדה תגובת HTTP חיה.
- ריצות הדוח האחרונות (בוקר ו-ערב, 13–14.08): `status=failed`, `completed_checks=0`. ריצה שלישית (ערב 14.08) נראתה תקועה על 0 גם היא בזמן האודיט.
- ענף ניסיוני נטוש `experiment/rebooks-browser-stage1` ניסה גישה עם Apify + דפדפן headless במקום fetch רגיל — ולא מוזג ל-main.

## 5. שתי רשומות `price_offers` שגויות (מהאודיט הקודם, טרם תוקנו)

**"מי הזיז את הגבינה שלי?"**
- `book_id: c234496e-b8c8-4fcf-91db-9b998365b32f`
- `offer_id: 737e5eb8-9a46-463a-a641-5ba8c2d365a3`
- נשמר עם `shipping_price=0` כדי שהסה"כ יראה 20 ₪, בלי אימות סניף איסוף אמיתי. משלוח אמיתי לנקודת חלוקה: 15 ₪ → סה"כ אמיתי: 35 ₪, מעל היעד.

**"המיליונר מהדלת ממול"**
- `offer_id: 2b963c96-a477-467d-834e-62d65e976aeb`
- `book_id: ad98d25f-c3f9-4b5f-a7b9-9363b9a12418`
- מקור: ספריית עם ישראל, 45 ₪, בלי סימון מלאי מפורש בדף המקור.
- `https://www.kodeshbook.co.il/PrintProductDetails.asp?Action=2Print&ProductId=12696`

## 6. הצעת תיקונים — לפי סדר עדיפויות (טרם אושר/בוצע דבר)

| # | תיקון | סיכון | קבצים/טבלאות |
|---|---|---|---|
| 0 | לייצא את 13 המיגרציות החסרות + קוד `recognize-book-cover` לגיט, כתיעוד בלבד, בלי לגעת ב-production | אפס | migrations חדשים, `supabase/functions/recognize-book-cover/*` |
| 1 | לשנות User-Agent/headers ב-fetch לדפדפן אמיתי, לבדוק על ספר אחד מול Rebooks בלבד לפני שמפעילים על כל 67 | נמוך-בינוני | `supabase/functions/alerts/index.ts` |
| 2 | לתעד רשמית את חוקי `expected_checks`/`completed` (רק מקורות `automatic` נספרים) כ-migration בגיט | בינוני | migration חדשה, `report_runs`, `report_checks` |
| 3 | לתקן את 2 רשומות ה-`price_offers` השגויות (סעיף 5) | נמוך | `public.price_offers` בלבד — לא `books` |
| 4 | להוסיף בדיקת CI שמוודאת שה-string-patch ב-`safe-app-loader.js` עדיין תואם ל-`app.js` | אפס-נמוך | `tests/` |
| 5 | הרצת בדיקת קבלה מלאה (ספרים נטענים בלי שינוי ב-`books`, כל הצעה נפתחת בדף מוצר אמיתי, אין מחיר מומצא, אין כפילויות) לפני חזרת תזמון אוטומטי | — | — |

**לא כלול בכוונה** (טעון אישור נפרד לפי כלל נעילת הדוח, סעיף 16 בהנחיות המקוריות): שינוי מקורות חיפוש, שינוי כללי סינון/דירוג, שינוי מבנה HTML של הדוח, הוספת שירות scraping חיצוני בתשלום.

## 7. כלל חובה עליון (חוזר תמיד, מכל שיחה)

אסור לערבב בין פרויקט "המדף החסר" (מסמך זה, Supabase `mfxhmnzyfhlaiqctchvb`) לבין פרויקט "ספרלי" — קוד, נתונים, טבלאות, קבצים, הקשר. שני פרויקטים נפרדים לגמרי, ללא יוצא מן הכלל.

## 8. מה עדיין לא נבדק/לא אומת

- הגדרות Auth ברמת הפלטפורמה (הגנת סיסמאות דלופות, הרשמה פתוחה).
- תוכן תגובת HTTP חיה בפועל מהאתרים החוסמים (ההשערה על User-Agent טרם אומתה בפועל).
- Deployment בפועל של ה-frontend מול ה-HEAD הנוכחי.
- כל ה-issues/PRs ב-GitHub (הבדיקה נכשלה עקב rate limit של GitHub API בזמן האודיט).
