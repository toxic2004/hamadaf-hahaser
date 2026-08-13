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

test("scanner does not call repeated search text a result", async () => {
  const { classifySearchResponse } = await scanner();
  const result = classifySearchResponse({
    sourceId: "simania",
    title: "הרגלים אטומיים",
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<html><h1>חיפוש הרגלים אטומיים</h1><a href='/book/1'>הרגלים אטומיים</a><span>מחיר 45 ש״ח</span></html>",
  });
  assert.equal(result.status, "manual_required");
  assert.equal(result.resultCount, 0);
});

test("Rebooks parser returns only an exact in-stock product with its sale price", async () => {
  const { classifySearchResponse } = await scanner();
  const body = `
    <div class="product-grid-item product post-12 instock" data-id="12">
      <h3 class="wd-entities-title"><a href="https://rebooks.org.il/product/current">ספר לדוגמה</a></h3>
      <span class="price"><del><span class="woocommerce-Price-amount amount"><bdi>25 &#8362;</bdi></span></del><ins><span class="woocommerce-Price-amount amount"><bdi>20 &#8362;</bdi></span></ins></span>
    </div>`;
  const result = classifySearchResponse({
    sourceId: "rebooks",
    title: "ספר לדוגמה",
    status: 200,
    contentType: "text/html",
    body,
  });
  assert.equal(result.status, "found");
  assert.equal(result.resultCount, 1);
  assert.deepEqual(result.offers[0], {
    source: "סיפור חוזר",
    sourceListingKey: "12",
    listingTitle: "ספר לדוגמה",
    sourceUrl: "https://rebooks.org.il/product/current",
    itemPrice: 20,
    availabilityStatus: "במלאי",
    condition: "יד שנייה",
    matchType: "מדויקת",
    editionLanguage: "עברית",
    shippingKnown: false,
    shippingPrice: null,
  });
});

test("Rebooks parser reports an exact out-of-stock product with price and link", async () => {
  const { classifySearchResponse } = await scanner();
  const body = `<div class="product-grid-item product outofstock" data-id="51"><h3 class="wd-entities-title"><a href="https://rebooks.org.il/product/missing">ספר חסר</a></h3><span class="woocommerce-Price-amount amount"><bdi>24 &#8362;</bdi></span></div>`;
  const result = classifySearchResponse({
    sourceId: "rebooks",
    title: "ספר חסר",
    status: 200,
    contentType: "text/html",
    body,
  });
  assert.equal(result.status, "found");
  assert.equal(result.resultCount, 1);
  assert.equal(result.offers[0].itemPrice, 24);
  assert.equal(result.offers[0].sourceUrl, "https://rebooks.org.il/product/missing");
  assert.equal(result.offers[0].availabilityStatus, "לא במלאי");
});

test("a product without explicit stock is not a result", async () => {
  const { classifySearchResponse } = await scanner();
  const body = `<div class="product-grid-item product" data-id="52"><h3 class="wd-entities-title"><a href="https://rebooks.org.il/product/unknown">ספר לא ברור</a></h3><span class="woocommerce-Price-amount amount"><bdi>20 &#8362;</bdi></span></div>`;
  const result = classifySearchResponse({
    sourceId: "rebooks",
    title: "ספר לא ברור",
    status: 200,
    contentType: "text/html",
    body,
  });
  assert.notEqual(result.status, "found");
  assert.equal(result.resultCount, 0);
});

test("Rebooks parser does not accept a similar title", async () => {
  const { classifySearchResponse } = await scanner();
  const body = `<div class="product-grid-item product instock" data-id="44"><h3 class="wd-entities-title"><a href="https://rebooks.org.il/product/other">ספר לדוגמה מורחב</a></h3><span class="woocommerce-Price-amount amount"><bdi>20 &#8362;</bdi></span></div>`;
  const result = classifySearchResponse({
    sourceId: "rebooks",
    title: "ספר לדוגמה",
    status: 200,
    contentType: "text/html",
    body,
  });
  assert.notEqual(result.status, "found");
  assert.equal(result.resultCount, 0);
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
