const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

async function scanner() {
  return import(path.join(root, "supabase/functions/alerts/scanner-core.mjs"));
}

test("scanner creates encoded source searches without accepting arbitrary hosts", async () => {
  const { sourcePlan } = await scanner();
  const plan = sourcePlan("simania", {
    title: "הרגלים אטומיים",
    author: "ג'יימס קליר",
  });
  assert.equal(plan.status, "pending");
  assert.match(
    plan.searchUrl,
    /^https:\/\/simania\.co\.il\/searchBooks\.php\?/,
  );
  assert.match(plan.searchUrl, /%D7%94%D7%A8%D7%92%D7%9C%D7%99%D7%9D/);
});

test("sources that require a browser finish with an honest explicit status", async () => {
  const { sourcePlan } = await scanner();
  assert.equal(
    sourcePlan("facebook_marketplace", { title: "ספר" }).status,
    "login_required",
  );
  assert.equal(
    sourcePlan("independent_and_general", { title: "ספר" }).status,
    "manual_required",
  );
});

test("scanner identifies an exact normalized Hebrew title", async () => {
  const { classifySearchResponse } = await scanner();
  const result = classifySearchResponse({
    sourceId: "simania",
    title: "הרגלים אטומיים",
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<html><h1>חיפוש הרגלים אטומיים</h1><a href='/book/1'>הרגלים אטומיים</a><span>מחיר 45 ש״ח</span></html>",
  });
  assert.equal(result.status, "found");
  assert.equal(result.resultCount, 1);
});

test("a reflected search heading alone is not reported as a product", async () => {
  const { classifySearchResponse } = await scanner();
  const result = classifySearchResponse({
    sourceId: "simania",
    title: "הרגלים אטומיים",
    status: 200,
    contentType: "text/html",
    body: "<html><h1>חיפוש ספרים: הרגלים אטומיים</h1></html>",
  });
  assert.equal(result.status, "manual_required");
  assert.equal(result.resultCount, 0);
});

test("scanner does not turn a generic successful page into a match", async () => {
  const { classifySearchResponse } = await scanner();
  const result = classifySearchResponse({
    sourceId: "booknet",
    title: "הרגלים אטומיים",
    status: 200,
    contentType: "text/html",
    body: "<html><h1>חנות ספרים</h1><p>לא נמצאו מוצרים</p></html>",
  });
  assert.equal(result.status, "not_found");
  assert.equal(result.resultCount, 0);
});

test("temporary and blocked responses remain distinguishable", async () => {
  const { classifySearchResponse } = await scanner();
  assert.equal(
    classifySearchResponse({
      sourceId: "evrit",
      title: "ספר",
      status: 429,
      contentType: "text/html",
      body: "",
    }).status,
    "temporary_error",
  );
  assert.equal(
    classifySearchResponse({
      sourceId: "steimatzky",
      title: "ספר",
      status: 200,
      contentType: "text/html",
      body: "Verify you are human. CAPTCHA",
    }).status,
    "blocked",
  );
});

test("preparation target gives every report several hourly scan windows", async () => {
  const { nextPreparationTarget } = await scanner();
  const settings = { morning_report_hour: 7, evening_check_hour: 21 };
  assert.deepEqual(nextPreparationTarget("2026-08-10", 6, settings), {
    localDate: "2026-08-10",
    kind: "morning",
  });
  assert.deepEqual(nextPreparationTarget("2026-08-10", 12, settings), {
    localDate: "2026-08-10",
    kind: "evening",
  });
  assert.deepEqual(nextPreparationTarget("2026-08-10", 22, settings), {
    localDate: "2026-08-11",
    kind: "morning",
  });
});
