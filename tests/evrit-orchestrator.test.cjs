const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function scanner() {
  return import(
    path.join(__dirname, "..", "supabase/functions/alerts/scanner-core.mjs")
  );
}

// Same fixtures already used in tests/evrit-parser.test.cjs (real
// structure confirmed 2026-08-16, and re-confirmed live 2026-08-31 via
// an actual web_fetch of https://www.e-vrit.co.il/Product/9199/).
const REAL_SEARCH_RESULT_HTML = `
  <div class="results">
    <a href="/Product/9199/%D7%90%D7%A0%D7%98%D7%99_%D7%A9%D7%91%D7%99%D7%A8">אנטי שביר</a>
    <a href="/Product/15655/%D7%97%D7%A9%D7%99%D7%A4%D7%94_%D7%9C%D7%A1%D7%99%D7%9B%D7%95%D7%9F">חשיפה לסיכון</a>
  </div>
`;
const REAL_PRODUCT_PAGE_HTML = `
  <div class="format-picker">
    <div>מודפס</div>
    <div>₪76.8</div>
    <div>גב הספר:₪96</div>
  </div>
  <button>הוספה לסל</button>
`;
const NO_PRINT_EDITION_HTML = `
  <div class="format-picker">
    <div>דיגיטלי</div>
    <div>₪27</div>
  </div>
`;

function mockFetch(responsesByUrlPart) {
  return async (url) => {
    for (const [urlPart, body] of responsesByUrlPart) {
      if (String(url).includes(urlPart)) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => "text/html; charset=utf-8" },
          text: async () => body,
        };
      }
    }
    throw new Error(`Unexpected URL in test: ${url}`);
  };
}

test("scanBookOnEvrit: full happy path - search finds the product link, product page yields a real price and in-stock status", async () => {
  const { scanBookOnEvrit } = await scanner();
  const fetchImpl = mockFetch([
    ["e-vrit.co.il/Search", REAL_SEARCH_RESULT_HTML],
    ["e-vrit.co.il", REAL_PRODUCT_PAGE_HTML],
  ]);
  const result = await scanBookOnEvrit(
    { title: "אנטי שביר", author: "נסים ניקולס טאלב" },
    { fetchImpl },
  );
  assert.equal(result.status, "found");
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].itemPrice, 76.8);
  assert.equal(result.offers[0].availabilityStatus, "במלאי");
  assert.equal(result.offers[0].source, "עברית");
});

test("scanBookOnEvrit: applies the known shipping policy (pickup approved in ראשון לציון)", async () => {
  const { scanBookOnEvrit } = await scanner();
  const fetchImpl = mockFetch([
    ["e-vrit.co.il/Search", REAL_SEARCH_RESULT_HTML],
    ["e-vrit.co.il", REAL_PRODUCT_PAGE_HTML],
  ]);
  const result = await scanBookOnEvrit(
    { title: "אנטי שביר", author: "" },
    { fetchImpl },
  );
  assert.equal(result.offers[0].shippingKnown, true);
  assert.equal(result.offers[0].shippingPrice, 0);
  assert.equal(result.offers[0].shippingPickupApproved, true);
});

test("scanBookOnEvrit: no matching title in search results returns not_found, never a guessed offer", async () => {
  const { scanBookOnEvrit } = await scanner();
  const fetchImpl = mockFetch([
    ["e-vrit.co.il/Search", REAL_SEARCH_RESULT_HTML],
  ]);
  const result = await scanBookOnEvrit(
    { title: "ספר שלא קיים בכלל", author: "" },
    { fetchImpl },
  );
  assert.equal(result.status, "not_found");
  assert.deepEqual(result.offers, []);
});

test("scanBookOnEvrit: product page exists but has no print edition - drops the offer instead of inventing a price", async () => {
  const { scanBookOnEvrit } = await scanner();
  const fetchImpl = mockFetch([
    ["e-vrit.co.il/Search", REAL_SEARCH_RESULT_HTML],
    ["e-vrit.co.il", NO_PRINT_EDITION_HTML],
  ]);
  const result = await scanBookOnEvrit(
    { title: "אנטי שביר", author: "" },
    { fetchImpl },
  );
  assert.equal(result.status, "manual_required");
  assert.deepEqual(result.offers, []);
});

test("scanBookOnEvrit: network failure on the initial search returns temporary_error, not a crash", async () => {
  const { scanBookOnEvrit } = await scanner();
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  const result = await scanBookOnEvrit(
    { title: "אנטי שביר", author: "" },
    { fetchImpl },
  );
  assert.equal(result.status, "temporary_error");
  assert.match(result.note, /network down/);
});

test("scanBookOnEvrit: product page fetch fails after a successful search - drops the offer rather than reporting an unverified price", async () => {
  const { scanBookOnEvrit } = await scanner();
  const fetchImpl = async (url) => {
    if (String(url).includes("Search")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/html; charset=utf-8" },
        text: async () => REAL_SEARCH_RESULT_HTML,
      };
    }
    throw new Error("product page unreachable");
  };
  const result = await scanBookOnEvrit(
    { title: "אנטי שביר", author: "" },
    { fetchImpl },
  );
  assert.equal(result.status, "manual_required");
  assert.deepEqual(result.offers, []);
});
