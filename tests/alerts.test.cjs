const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

async function core() {
  return import(path.join(root, "supabase/functions/alerts/core.mjs"));
}

test("scheduled alerts prepare the next configured report throughout the day", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );

  assert.match(
    source,
    /nextPreparationTarget\(localDate, localHour, settings\)/,
  );
  assert.match(source, /scanOldestRun\(userId\)/);
  assert.match(
    source,
    /runIsDue\(completedRun, local\.date, local\.hour, settings\)/,
  );
});

test("missing settings default to reports at 07:00 and 21:00", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );

  assert.match(source, /morning_report_hour: 7/);
  assert.match(source, /evening_check_hour: 21/);
  assert.match(source, /email_enabled: true/);
  assert.doesNotMatch(source, /evening_check_hour: 19/);
});

test("Jerusalem time handles winter and summer offsets", async () => {
  const { jerusalemParts } = await core();
  assert.deepEqual(jerusalemParts(new Date("2026-01-15T05:00:00Z")), {
    date: "2026-01-15",
    hour: 7,
  });
  assert.deepEqual(jerusalemParts(new Date("2026-07-15T04:00:00Z")), {
    date: "2026-07-15",
    hour: 7,
  });
  assert.deepEqual(jerusalemParts(new Date("2026-07-20T21:30:00Z")), {
    date: "2026-07-21",
    hour: 0,
  });
});

test("configured hours select the correct scheduled run", async () => {
  const { scheduledKinds } = await core();
  const settings = { morning_report_hour: 8, evening_check_hour: 20 };
  assert.deepEqual(scheduledKinds(settings, 8), ["בוקר"]);
  assert.deepEqual(scheduledKinds(settings, 20), ["ערב"]);
  assert.deepEqual(scheduledKinds(settings, 12), []);
  assert.deepEqual(
    scheduledKinds({ morning_report_hour: 9, evening_check_hour: 9 }, 9),
    ["בוקר", "ערב"],
  );
});

test("price drops are detected only when the total becomes lower", async () => {
  const { priceDrop } = await core();
  assert.deepEqual(priceDrop(85, 60), { previous: 85, current: 60 });
  assert.equal(priceDrop(60, 60), null);
  assert.equal(priceDrop(60, 75), null);
  assert.equal(priceDrop("unknown", 50), null);
});

test("report shows a book again only for a new or lower delivered price", async () => {
  const { reportOfferChanges } = await core();
  const offers = [
    { book_id: "book-1", total_price: 40, source: "חדש" },
    { book_id: "book-1", total_price: 45, source: "יקר יותר" },
    { book_id: "book-2", total_price: 25, source: "ללא היסטוריה" },
  ];
  const deliveredReports = [
    {
      metadata: {
        reported_offers: [
          { book_id: "book-1", total_price: 50 },
          { book_id: "book-3", total_price: 30 },
        ],
      },
    },
  ];
  assert.deepEqual(reportOfferChanges(offers, deliveredReports), [
    {
      book_id: "book-1",
      total_price: 40,
      source: "חדש",
      previous_price: 50,
      savings: 10,
      change_type: "lower",
    },
    {
      book_id: "book-2",
      total_price: 25,
      source: "ללא היסטוריה",
      previous_price: null,
      savings: null,
      change_type: "new",
    },
  ]);

  assert.deepEqual(
    reportOfferChanges(
      [{ book_id: "book-1", total_price: 50 }],
      deliveredReports,
    ),
    [],
  );
  assert.deepEqual(
    reportOfferChanges(
      [{ book_id: "book-1", total_price: 55 }],
      deliveredReports,
    ),
    [],
  );
});

test("report accepts any known delivered total, and dealTier classifies used vs new (two-tier pricing, 2026-08-16)", async () => {
  const { MAX_REPORT_TOTAL, reportableOfferTotal, dealTier } = await core();
  assert.equal(MAX_REPORT_TOTAL, 30);
  assert.equal(
    reportableOfferTotal({ shipping_known: true, total_price: 30 }),
    30,
  );
  // Two-tier pricing fix: totals above 30 are no longer rejected outright -
  // new-book sources (Evrit, Steimatzky, Booknet) never price near 30 ₪ and
  // could never appear in a report otherwise. They're still valid, just
  // classified into the "new" (informational) tier by dealTier().
  assert.equal(
    reportableOfferTotal({ shipping_known: true, total_price: 96 }),
    96,
  );
  assert.equal(
    reportableOfferTotal({ shipping_known: false, total_price: 20 }),
    null,
  );
  assert.equal(
    reportableOfferTotal({ shipping_known: true, total_price: null }),
    null,
  );
  assert.equal(dealTier(30), "used");
  assert.equal(dealTier(30.01), "new");
  assert.equal(dealTier(96), "new");
  assert.equal(dealTier(0), "used");
});

test("report quality rejects search pages, partial scans, and empty reports", async () => {
  const { isCompleteReportOffer, isDirectProductUrl, reportQualityGate } =
    await core();
  const completeRun = {
    status: "completed",
    expected_books: 1,
    expected_checks: 8,
    completed_checks: 8,
  };
  const offer = {
    book_id: "book-1",
    source: "סיפור חוזר",
    item_price: 20,
    total_price: 30,
    shipping_known: true,
    availability_status: "במלאי",
    source_url: "https://rebooks.org.il/product/example-book/",
  };

  assert.equal(isDirectProductUrl(offer.source_url), true);
  assert.equal(
    isDirectProductUrl("https://rebooks.org.il/?s=example&post_type=product"),
    false,
  );
  assert.equal(
    isDirectProductUrl("https://www.google.com/search?q=example+book"),
    false,
  );
  assert.equal(isCompleteReportOffer(offer), true);
  assert.equal(reportQualityGate(completeRun, [offer]), true);
  assert.equal(reportQualityGate(completeRun, []), false);
  assert.equal(
    reportQualityGate({ ...completeRun, completed_checks: 7 }, [offer]),
    false,
  );
  assert.equal(
    reportQualityGate(completeRun, [
      {
        ...offer,
        source_url: "https://rebooks.org.il/?s=example&post_type=product",
      },
    ]),
    false,
  );
});

test("email content omits scanner and cover metrics", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );
  const emailBuilder = source.slice(
    source.indexOf("async function buildReportEmail"),
    source.indexOf("function runIsDue"),
  );
  assert.doesNotMatch(
    emailBuilder,
    /coverage|completed_checks|expected_checks/,
  );
  assert.doesNotMatch(emailBuilder, /כריכות|בדיקות מקור|מצבי מקור|חסם גישה/);
  assert.doesNotMatch(emailBuilder, /מחיר קודם/);
  assert.doesNotMatch(emailBuilder, /חיסכון/);
  assert.match(emailBuilder, /source_url/);
  assert.match(emailBuilder, /bundledNotificationIds/);
  assert.doesNotMatch(emailBuilder, /כדאי לבדוק מחדש אם ההצעה עדיין זמינה/);
  assert.doesNotMatch(emailBuilder, /הצעה פעילה שאומתה לאחרונה/);
  assert.match(emailBuilder, /last_checked_at/);
  assert.match(emailBuilder, /availability_status/);
  assert.match(emailBuilder, /\["במלאי", "לא במלאי"\]/);
  assert.match(emailBuilder, /\.not\("item_price", "is", null\)/);
  assert.match(emailBuilder, /\.not\("source_url", "is", null\)/);
  assert.match(emailBuilder, /\.eq\("shipping_known", true\)/);
  assert.match(
    emailBuilder,
    /item_price,total_price,shipping_known,source_url/,
  );
  assert.match(emailBuilder, /\.not\("total_price", "is", null\)/);
  // Two-tier pricing fix (2026-08-16): the .lte("total_price",
  // MAX_REPORT_TOTAL) filter was removed from the SQL query entirely -
  // every valid offer is now fetched, and dealTier() classifies it.
  assert.doesNotMatch(
    emailBuilder,
    /\.lte\("total_price", MAX_REPORT_TOTAL\)/,
  );
  assert.match(emailBuilder, /dealTier/);
  assert.match(emailBuilder, /מחיר כולל משלוח/);
  assert.match(emailBuilder, /ירידת מחיר/);
  assert.match(emailBuilder, /הצעה חדשה/);
  assert.match(emailBuilder, /ללא שינוי במחיר/);
  assert.match(emailBuilder, /escapeHtml\(offer\.source\)/);
  assert.match(emailBuilder, />לצפייה במוצר<\/a>/);
  assert.match(emailBuilder, /<table role="presentation"/);
  assert.match(emailBuilder, /background:#102a43/);
  assert.match(emailBuilder, /background:#2dd4bf/);
  assert.match(emailBuilder, /background:#ffffff/);
  assert.match(emailBuilder, /style="display:block;background:\$\{buttonColor\}/);
  assert.doesNotMatch(emailBuilder, /<style[\s>]/i);
  assert.doesNotMatch(emailBuilder, /class=/i);
  assert.doesNotMatch(emailBuilder, /<script[\s>]/i);
  assert.doesNotMatch(emailBuilder, /מצאנו \$\{displayOffers\.length\}/);
  assert.doesNotMatch(emailBuilder, /לא נמצאה הצעה מתאימה/);
});

test("two-tier pricing (2026-08-16): email renders separate used/new sections, never phrasing new-book offers as a recommendation", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );
  const emailBuilder = source.slice(
    source.indexOf("async function buildReportEmail"),
    source.indexOf("function runIsDue"),
  );
  assert.match(emailBuilder, /usedOffers/);
  assert.match(emailBuilder, /newOffers/);
  assert.match(emailBuilder, /מידע בלבד/);
  assert.match(emailBuilder, /הצעות יד שנייה/);
  assert.match(emailBuilder, /ספרים חדשים/);
  // The new-tier badge/section text must never claim it's a recommendation.
  assert.doesNotMatch(emailBuilder, /מומלץ[^`]*ספר חדש/);
  assert.match(emailBuilder, /לא המלצת רכישה/);
});

test("empty or incomplete reports never enter the Gmail queue", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );
  const finalizer = source.slice(
    source.indexOf("async function finalizeScheduledRun"),
    source.indexOf("async function processSchedule"),
  );
  const qualityGate = finalizer.indexOf("reportQualityGate");
  const reportInsert = finalizer.indexOf("const report = await insertNotification");
  assert.ok(qualityGate > 0);
  assert.ok(reportInsert > qualityGate);
  assert.match(finalizer, /if \(!emailHtml \|\| !reportQualityGate/);
  assert.match(finalizer, /report_skipped: "quality_gate"/);
  assert.doesNotMatch(finalizer, /נמצאו \$\{reportedOffers\.length\}/);
});

test("morning and evening email records expose books only", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );
  const reportRecord = source.slice(
    source.indexOf("const report = await insertNotification"),
    source.indexOf("if (report) created.push(report)"),
  );
  assert.match(reportRecord, /content_policy: "books_only_v1"/);
  assert.match(reportRecord, /reported_offers: reportedOffers/);
  assert.match(reportRecord, /email_html: emailHtml/);
  assert.doesNotMatch(
    reportRecord,
    /expected_books|expected_checks|completed_checks|coverage_percent|active_offers|worthwhile|due:/,
  );
});

test("email report change policy remains explicit and approval gated", () => {
  const policy = fs.readFileSync(
    path.join(root, "docs/email-report-change-policy.md"),
    "utf8",
  );
  assert.match(
    policy,
    /אין לשנות רכיב כלשהו בדוח ההתראות במייל ללא אישור מפורש/,
  );
  assert.match(policy, /בקשת מיזוג 34/);
  assert.match(policy, /גרסה 15/);
  assert.match(policy, /נקודת החזרה של פונקציית ההתראות היא גרסה 14/);
  assert.match(policy, /דוחות הבוקר והערב מציגים מידע על ספרים והצעות בלבד/);
  assert.match(policy, /המידע הטכני נשמר ברקע בלבד/);
  assert.match(
    policy,
    /תוצאה מוצגת רק כאשר קיימים יחד מחיר מספרי, קישור ישיר למוצר ומצב מלאי מפורש/,
  );
  assert.match(policy, /"במלאי" או "לא במלאי"/);
  assert.match(policy, /חוק מחיר כולל עד 30 ש״ח/);
  assert.match(policy, /המחיר הכולל שלהם\s+הוא עד 30 ש״ח/);
  assert.match(policy, /אין להניח שמחיר המשלוח\s+הוא אפס/);
  assert.match(policy, /חוק עיצוב ותאימות Gmail/);
  assert.match(policy, /עיצוב בהיר, נקי והייטקי/);
  assert.match(policy, /כל סגנונות התצוגה\s+יוטמעו ישירות ברכיבי ה HTML/);
  assert.match(policy, /אין להסתמך על תגית style/);
  assert.match(policy, /חוק איכות ושליחה/);
  assert.match(policy, /דוח חלקי אינו\s+נשלח/);
  assert.match(policy, /דף חיפוש, דף קטלוג או כתובת\s+חיפוש כללית אינם הצעה/);
  assert.match(policy, /דוח ללא הצעה מלאה ואמינה אינו נשלח/);
  assert.match(policy, /אין\s+להציג ספירת בדיקות, מקורות, ניסיונות, תוצאות, הצעות/);
});

test("deal notifications reject unsuitable offers", async () => {
  const { dealTotal } = await core();
  const suitable = {
    total_price: 30,
    shipping_known: true,
    edition_language: "עברית",
    availability_status: "במלאי",
    match_type: "התאמה מלאה",
    active: true,
    is_removed: false,
    deal_score: 80,
  };
  assert.equal(dealTotal(suitable, 70), 30);
  assert.equal(dealTotal({ ...suitable, deal_score: 69 }, 70), null);
  assert.equal(
    dealTotal({ ...suitable, edition_language: "אנגלית" }, 70),
    null,
  );
  assert.equal(dealTotal({ ...suitable, match_type: "לא התאמה" }, 70), null);
  assert.equal(dealTotal({ ...suitable, active: false }, 70), null);
  assert.equal(dealTotal({ ...suitable, is_removed: true }, 70), null);
  assert.equal(dealTotal({ ...suitable, total_price: null }, 70), null);
  assert.equal(dealTotal({ ...suitable, total_price: 30.01 }, 70), null);
  assert.equal(dealTotal({ ...suitable, shipping_known: false }, 70), null);
  assert.equal(
    dealTotal({ ...suitable, availability_status: "לא במלאי" }, 70),
    null,
  );
});

test("dedupe keys are stable and change only with the relevant price", async () => {
  const { dealDedupeKey, priceDropDedupeKey } = await core();
  assert.equal(dealDedupeKey("offer-1", 42), "offer-1:deal:42");
  assert.equal(dealDedupeKey("offer-1", 42), dealDedupeKey("offer-1", 42));
  assert.notEqual(dealDedupeKey("offer-1", 40), dealDedupeKey("offer-1", 42));
  assert.equal(priceDropDedupeKey("offer-1", 35), "offer-1:drop:35");
});

test("schedule access requires the configured secret", async () => {
  const { isScheduleAuthorized } = await core();
  assert.equal(isScheduleAuthorized("secret", "secret"), true);
  assert.equal(isScheduleAuthorized("secret", "wrong"), false);
  assert.equal(isScheduleAuthorized("secret", null), false);
  assert.equal(isScheduleAuthorized("", ""), false);
  assert.equal(isScheduleAuthorized("secret", "secret-extra"), false);
});

test("offer identifiers must be valid UUIDs", async () => {
  const { isUuid } = await core();
  assert.equal(isUuid("9a9f20f2-3f70-4bc2-8dc3-d57ed27de941"), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid("' or true; --"), false);
  assert.equal(isUuid(null), false);
});

test("only explicit supported request modes are accepted", async () => {
  const { requestMode } = await core();
  assert.equal(requestMode("offer"), "offer");
  assert.equal(requestMode("schedule"), "schedule");
  assert.equal(requestMode(undefined), null);
  assert.equal(requestMode("admin"), null);
});

test("alert endpoint limits and validates incoming requests", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );
  assert.match(source, /MAX_BODY_BYTES = 16_384/);
  assert.match(source, /content type must be application\/json/);
  assert.match(source, /request body too large/);
  assert.match(
    source,
    /authorization\.toLowerCase\(\)\.startsWith\("bearer "\)/,
  );
});

test("database failures are not ignored and Gmail stays the only delivery path", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );
  assert.match(source, /if \(snapshot\.error\) throw snapshot\.error/);
  assert.match(source, /if \(created\.error\) throw created\.error/);
  assert.match(source, /if \(applied\.error\) throw applied\.error/);
  assert.match(source, /if \(completed\.error\) throw completed\.error/);
  assert.match(source, /if \(reschedule\.error\) throw reschedule\.error/);
  assert.match(source, /emailDelivery: "gmail_queue"/);
  assert.doesNotMatch(source, /RESEND_API_KEY|api\.resend\.com/);
});

test("JSON responses prevent caching and MIME sniffing", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );
  assert.match(source, /"cache-control": "no-store"/);
  assert.match(source, /"x-content-type-options": "nosniff"/);
});

test("scheduled runs open a complete report coverage matrix", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );
  assert.match(source, /start_report_run_for_user/);
  assert.match(source, /expected_checks/);
  assert.match(source, /report_run_id/);
});

test("the hourly scheduler cannot enqueue a report before coverage completes", () => {
  const migration = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260810085148_complete_report_scanner.sql",
    ),
    "utf8",
  );
  const scheduler = migration.slice(
    migration.indexOf(
      "create or replace function private.invoke_alerts_hourly",
    ),
  );
  assert.match(scheduler, /timeout_milliseconds := 110000/);
  assert.doesNotMatch(scheduler, /insert into public\.notifications/);
  assert.match(migration, /apply_report_check_results/);
  assert.match(migration, /email_address,\s+notifications\.metadata/);
});

test("GitHub alert workflow is a manual fallback", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/price-alerts.yml"),
    "utf8",
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:/);
});

test("alerts deployment workflow is manual and serialized", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/deploy-alerts.yml"),
    "utf8",
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /push:/);
  assert.match(workflow, /group: deploy-supabase-alerts/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test("Supabase schedules alerts hourly with a Vault secret", () => {
  const migration = fs.readFileSync(
    path.join(root, "supabase/006_alerts_schedule_security.sql"),
    "utf8",
  );
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );

  assert.match(migration, /'invoke-alerts-hourly'/);
  assert.match(migration, /'0 \* \* \* \*'/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
  assert.match(source, /verify_alerts_schedule_secret/);
});

test("alerts deployment validates credentials and deploys without JWT verification", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/deploy-alerts.yml"),
    "utf8",
  );

  assert.match(workflow, /secrets\.SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /secrets\.SUPABASE_PROJECT_REF/);
  assert.match(workflow, /supabase\/setup-cli@v1/);
  assert.match(workflow, /supabase functions deploy alerts/);
  assert.match(workflow, /--project-ref "\$SUPABASE_PROJECT_REF"/);
  assert.match(workflow, /--no-verify-jwt/);
});

test("manual deployed alerts test is guarded and uses repository secrets", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/test-alerts.yml"),
    "utf8",
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /test \"\$CONFIRMATION\" = \"RUN\"/);
  assert.match(workflow, /secrets\.SUPABASE_ALERTS_URL/);
  assert.match(workflow, /secrets\.SUPABASE_ALERTS_SCHEDULE_SECRET/);
  assert.match(workflow, /npm run test:alerts:live/);
  assert.doesNotMatch(workflow, /schedule:\s*\n/);
});

test("manual alerts test rejects bad authorization before invoking the schedule", () => {
  const source = fs.readFileSync(
    path.join(root, "scripts/alerts-smoke-test.mjs"),
    "utf8",
  );

  assert.match(source, /invalidSecret/);
  assert.match(source, /status !== 401/);
  assert.match(source, /accepted\.body\?\.ok !== true/);
  assert.match(source, /AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/);
  assert.doesNotMatch(source, /console\.log\([^\n]*process\.env/i);
  assert.doesNotMatch(source, /console\.log\([^\n]*\$\{secret\}/i);
});

test("reportSubject matches the exact required format for both report kinds", async () => {
  const { reportSubject } = await core();
  assert.equal(
    reportSubject("morning", "2026-08-15"),
    "המדף החסר: דוח בוקר 15.08.2026",
  );
  assert.equal(
    reportSubject("evening", "2026-01-03"),
    "המדף החסר: דוח ערב 03.01.2026",
  );
});

test("reportSubject never produces the older, non-conforming title format", async () => {
  const { reportSubject } = await core();
  const subject = reportSubject("evening", "2026-08-13");
  // Regression guard for the exact bug found in a real sent email during
  // the 2026-08-14 audit: "דוח ערב של המדף החסר" instead of the required
  // "המדף החסר: דוח ערב DD.MM.YYYY".
  assert.doesNotMatch(subject, /^דוח (בוקר|ערב) של המדף החסר/);
  assert.match(subject, /^המדף החסר: דוח (בוקר|ערב) \d{2}\.\d{2}\.\d{4}$/);
});
