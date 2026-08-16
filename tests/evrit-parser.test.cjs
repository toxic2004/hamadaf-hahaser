const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

async function scanner() {
  return import(path.join(root, "supabase/functions/alerts/scanner-core.mjs"));
}

// Real search-result link structure, minimal markup - the one confirmed
// structural fact is that Evrit product URLs (/product/{id}/{slug} or
// /Product/{id}/{slug}) are linked with the book title as visible text,
// confirmed via search engine indexing of these exact URLs on 2026-08-16.
const REAL_SEARCH_RESULT_HTML = `
  <div class="results">
    <a href="/Product/9199/%D7%90%D7%A0%D7%98%D7%99_%D7%A9%D7%91%D7%99%D7%A8">אנטי שביר</a>
    <a href="/Product/15655/%D7%97%D7%A9%D7%99%D7%A4%D7%94_%D7%9C%D7%A1%D7%99%D7%9B%D7%95%D7%9F">חשיפה לסיכון</a>
  </div>
`;

// Real product-page price block, sampled verbatim from the actual live
// page for "אנטי שביר" (2026-08-16): "מודפס ₪76.8 גב הספר:₪96".
const REAL_PRODUCT_PAGE_HTML = `
  <div class="format-picker">
    <div>מודפס</div>
    <div>₪76.8</div>
    <div>גב הספר:₪96</div>
  </div>
  <button>הוספה לסל</button>
`;

test("extractEvritProductLink finds the exact matching title and returns the product URL", async () => {
  const { extractEvritProductLink } = await scanner();
  const url = extractEvritProductLink(REAL_SEARCH_RESULT_HTML, "אנטי שביר");
  assert.equal(url, "/Product/9199/%D7%90%D7%A0%D7%98%D7%99_%D7%A9%D7%91%D7%99%D7%A8");
});

test("extractEvritProductLink does not match a different book on the same page", async () => {
  const { extractEvritProductLink } = await scanner();
  const url = extractEvritProductLink(
    REAL_SEARCH_RESULT_HTML,
    "ספר שלא קיים בדף הזה",
  );
  assert.equal(url, null);
});

test("extractEvritProductDetails reads the exact real price and marks it in stock", async () => {
  const { extractEvritProductDetails } = await scanner();
  const details = extractEvritProductDetails(REAL_PRODUCT_PAGE_HTML);
  assert.deepEqual(details, { itemPrice: 76.8, availabilityStatus: "במלאי" });
});

test("extractEvritProductDetails returns null when there is no print price at all (digital-only book)", async () => {
  const { extractEvritProductDetails } = await scanner();
  const digitalOnly = `<div>דיגיטלי</div><div>₪32</div>`;
  assert.equal(extractEvritProductDetails(digitalOnly), null);
});

test("extractEvritProductDetails marks out of stock when an אזל marker sits near a still-shown print price", async () => {
  const { extractEvritProductDetails } = await scanner();
  const outOfStockHtml = `<div>מודפס</div><div>₪76.8</div><div>אזל מהמלאי</div>`;
  const details = extractEvritProductDetails(outOfStockHtml);
  assert.equal(details.availabilityStatus, "לא במלאי");
});

test("evritShipping always resolves to free self-pickup (fixed, always-approved warehouse in Rishon LeZion)", async () => {
  const { evritShipping } = await scanner();
  assert.deepEqual(evritShipping(), { price: 0, method: "pickup" });
});
