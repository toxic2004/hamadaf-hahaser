# render-server — הוראות פריסה ל-Render

שרת עצמאי, קטן, שמריץ דפדפן headless אמיתי (Playwright + Chromium) כדי לרנדר דפים שדורשים JavaScript — כרגע רק עברית (e-vrit.co.il), כי Supabase Edge Functions לא יכולות להריץ דפדפן בכלל (מגבלת פלטפורמה מאושרת, לא עקיפה של כלום).

## למה זה צריך פריסה נפרדת

זה **לא** רץ בתוך ה-Edge Function של `alerts`. זה שירות נפרד לגמרי, שה-Edge Function תקרא אליו כמו לכל API חיצוני.

## שלב 1: יצירת חשבון Render

1. גש ל-[render.com](https://render.com) והירשם (אפשר עם GitHub — מומלץ, זה גם מקל על החיבור לריפו).

## שלב 2: יצירת Web Service חדש

1. בלוח הבקרה של Render, לחץ **New +** → **Web Service**.
2. חבר את ריפו ה-GitHub `toxic2004/hamadaf-hahaser` (אשר גישה אם מתבקש).
3. **חשוב**: תחת "Root Directory", הזן: `render-server`
4. תחת "Runtime", בחר: **Docker**
5. Render יזהה את ה-`Dockerfile` אוטומטית בתיקייה הזו.

## שלב 3: הגדרת משתנה סביבה (Environment Variable)

1. עדיין במסך ההגדרות, גלול ל-**Environment**.
2. הוסף משתנה:
   - **Key**: `RENDER_SHARED_SECRET`
   - **Value**: מחרוזת אקראית וארוכה משלך (למשל, תריץ בטרמינל: `openssl rand -hex 32` ותדביק את התוצאה). **שמור את הערך הזה בצד** — תצטרך לשלוח לי אותו בהמשך.

## שלב 4: בחירת תוכנית (Plan)

- לרוב השימוש שלנו, התוכנית **Free** מספיקה. אם תראה קריסות בגלל זיכרון, נעבור לתוכנית בתשלום הזולה ביותר (Starter, כ-7$/חודש).

## שלב 5: פריסה

1. לחץ **Create Web Service**.
2. פריסה ראשונה עשויה לקחת כמה דקות (בניית Docker image עם Chromium).
3. בסיום, Render יציג לך כתובת כמו: `https://hamadaf-hahaser-render-server.onrender.com`

## שלב 6: שלח לי

שני דברים:
1. הכתובת המלאה (ה-URL) שקיבלת מ-Render.
2. הערך של `RENDER_SHARED_SECRET` שהגדרת בשלב 3.

אשמור את הסוד ב-Supabase Vault (כמו שכבר עשיתי ל-Gmail App Password), ואחבר את ה-Edge Function לשירות החדש.

## בדיקה ידנית (אופציונלי, לפני ששולח לי)

אחרי הפריסה, אפשר לבדוק שהשרת חי:
```
curl https://YOUR-URL.onrender.com/health
```
אמור להחזיר: `{"ok":true}`

**הערה על "התעוררות" (Free tier בלבד):** אם לא היה שימוש 15 דקות, השרת "נרדם" ומתעורר תוך כ-30-60 שניות בבקשה הראשונה אחרי זה. זה בסדר גמור בשימוש שלנו (הסריקה כבר איטית בכוונה).
