const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

async function core() {
  return import(path.join(root, "supabase/functions/alerts/core.mjs"));
}

test("scheduled alerts respect each user's configured hours", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );

  assert.match(source, /scheduledKinds\(settings, local\.hour\)/);
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

test("deal notifications reject unsuitable offers", async () => {
  const { dealTotal } = await core();
  const suitable = {
    total_price: 42,
    edition_language: "עברית",
    match_type: "התאמה מלאה",
    active: true,
    is_removed: false,
    deal_score: 80,
  };
  assert.equal(dealTotal(suitable, 70), 42);
  assert.equal(dealTotal({ ...suitable, deal_score: 69 }, 70), null);
  assert.equal(
    dealTotal({ ...suitable, edition_language: "אנגלית" }, 70),
    null,
  );
  assert.equal(dealTotal({ ...suitable, match_type: "לא התאמה" }, 70), null);
  assert.equal(dealTotal({ ...suitable, active: false }, 70), null);
  assert.equal(dealTotal({ ...suitable, is_removed: true }, 70), null);
  assert.equal(dealTotal({ ...suitable, total_price: null }, 70), null);
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

test("email requests time out and database failures are not ignored", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );
  assert.match(source, /AbortSignal\.timeout\(10_000\)/);
  assert.match(source, /if \(snapshot\.error\) throw snapshot\.error/);
  assert.match(source, /if \(completed\.error\) throw completed\.error/);
  assert.match(source, /if \(reschedule\.error\) throw reschedule\.error/);
});

test("JSON responses prevent caching and MIME sniffing", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );
  assert.match(source, /"cache-control": "no-store"/);
  assert.match(source, /"x-content-type-options": "nosniff"/);
});

test("email delivery failures are surfaced for safe handling", async () => {
  const { assertEmailAccepted } = await core();
  assert.doesNotThrow(() => assertEmailAccepted({ ok: true, status: 200 }));
  assert.throws(
    () => assertEmailAccepted({ ok: false, status: 503 }),
    /Email failed with 503/,
  );
});

test("alert workflow runs hourly to support configurable hours", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/price-alerts.yml"),
    "utf8",
  );

  assert.match(workflow, /cron: "0 \* \* \* \*"/);
});

test("alerts deployment workflow is automatic, scoped, and serialized", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/deploy-alerts.yml"),
    "utf8",
  );

  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /supabase\/functions\/alerts\/\*\*/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group: deploy-supabase-alerts/);
  assert.match(workflow, /cancel-in-progress: false/);
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
