const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function scanner() {
  return import(
    path.join(__dirname, "..", "supabase/functions/alerts/scanner-core.mjs")
  );
}

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

// === Booknet (single-fetch: search page already has the real price) ===
// Same fixture as tests/steimatzky-booknet.test.cjs (real structure,
// 2026-08-16; re-confirmed live 2026-08-31 via web_search - the exact
// "מחיר נוכחי: 96 שח" phrase still appears for this book today).
const REAL_BOOKNET_HTML = `
  <a href="https://www.booknet.co.il/מוצרים/אנטי-שביר-100026207">אנטי שביר אנטי שביר</a>
  <a href="https://www.booknet.co.il/מחברים/טאלב-ניקולס-נסים">ניקולס נסים טאלב</a>
  מחיר מכירה מודפס ==96 ₪==
  אנטי שביר, ניקולס נסים טאלב, מחיר נוכחי: 96 שח,מחיר קודם: 96 שח  הוסף לסל
`;

test("scanBookOnBooknet: happy path returns a fully-formed offer straight from the search page, no second fetch", async () => {
  const { scanBookOnBooknet } = await scanner();
  const fetchImpl = mockFetch([["booknet.co.il", REAL_BOOKNET_HTML]]);
  const result = await scanBookOnBooknet(
    { title: "אנטי שביר", author: "" },
    { fetchImpl },
  );
  assert.equal(result.status, "found");
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].itemPrice, 96);
  assert.equal(result.offers[0].availabilityStatus, "במלאי");
});

test("scanBookOnBooknet: no title match returns not_found", async () => {
  const { scanBookOnBooknet } = await scanner();
  const fetchImpl = mockFetch([["booknet.co.il", REAL_BOOKNET_HTML]]);
  const result = await scanBookOnBooknet(
    { title: "ספר שלא קיים", author: "" },
    { fetchImpl },
  );
  assert.equal(result.status, "not_found");
  assert.deepEqual(result.offers, []);
});

test("scanBookOnBooknet: network failure returns temporary_error, not a crash", async () => {
  const { scanBookOnBooknet } = await scanner();
  const fetchImpl = async () => {
    throw new Error("dns failure");
  };
  const result = await scanBookOnBooknet(
    { title: "אנטי שביר", author: "" },
    { fetchImpl },
  );
  assert.equal(result.status, "temporary_error");
});

// === Steimatzky (two-step: search -> relative product link -> product page) ===
const REAL_STEIMATZKY_SEARCH_HTML = `<a href="/012010227">אנטי שביר</a>`;
const REAL_STEIMATZKY_PRODUCT_HTML = `
  <html><head>
  <meta property="og:product:price:amount" content="96.0000" />
  </head><body>
  <div>הוספה לסל</div>
  </body></html>
`;

test("scanBookOnSteimatzky: resolves the relative product link against the site base before fetching it (same class of bug already found and fixed for Evrit)", async () => {
  const { scanBookOnSteimatzky } = await scanner();
  const fetchImpl = mockFetch([
    ["steimatzky.co.il/catalogsearch", REAL_STEIMATZKY_SEARCH_HTML],
    ["steimatzky.co.il/012010227", REAL_STEIMATZKY_PRODUCT_HTML],
  ]);
  const result = await scanBookOnSteimatzky(
    { title: "אנטי שביר", author: "" },
    { fetchImpl },
  );
  assert.equal(result.status, "found");
  assert.equal(result.offers[0].itemPrice, 96);
  assert.equal(result.offers[0].availabilityStatus, "במלאי");
  assert.equal(
    result.offers[0].sourceUrl,
    "https://www.steimatzky.co.il/012010227",
  );
});

test("scanBookOnSteimatzky: product page found but no usable price meta tag - drops the offer instead of inventing a price", async () => {
  const { scanBookOnSteimatzky } = await scanner();
  const fetchImpl = mockFetch([
    ["steimatzky.co.il/catalogsearch", REAL_STEIMATZKY_SEARCH_HTML],
    ["steimatzky.co.il/012010227", "<html><body>no price here</body></html>"],
  ]);
  const result = await scanBookOnSteimatzky(
    { title: "אנטי שביר", author: "" },
    { fetchImpl },
  );
  assert.equal(result.status, "manual_required");
  assert.deepEqual(result.offers, []);
});

test("scanBookOnSteimatzky: no title match on search returns not_found", async () => {
  const { scanBookOnSteimatzky } = await scanner();
  const fetchImpl = mockFetch([
    ["steimatzky.co.il/catalogsearch", REAL_STEIMATZKY_SEARCH_HTML],
  ]);
  const result = await scanBookOnSteimatzky(
    { title: "ספר אחר", author: "" },
    { fetchImpl },
  );
  assert.equal(result.status, "not_found");
});

// === Findabook (single-fetch, absolute URLs already) ===
const REAL_FINDABOOK_SEARCH_HTML = `
  <li><figure>
  <a class="hover-text" href="https://www.findabook.co.il/book/583166/הליכת-אקראי-בוול-סטריטברטון-גימלכיאל"><span>לחצו לפרטים</span></a>
  </figure><h3>הליכת אקראי בוול סטריט/ברטון ג'י.מלכיאל</h3><ul><li class="strong">98 ₪ </li></ul>
  <p><a href="https://www.findabook.co.il/book/583166/הליכת-אקראי-בוול-סטריטברטון-גימלכיאל" class="btn">רכישה ישירה</a></p></li>
`;

test("scanBookOnFindabook: happy path, single fetch, real price straight from the search page", async () => {
  const { scanBookOnFindabook } = await scanner();
  const fetchImpl = mockFetch([
    ["findabook.co.il/result", REAL_FINDABOOK_SEARCH_HTML],
  ]);
  const result = await scanBookOnFindabook(
    { title: "הליכת אקראי בוול סטריט", author: "" },
    { fetchImpl },
  );
  assert.equal(result.status, "found");
  assert.equal(result.offers[0].itemPrice, 98);
  // Known, pre-existing limitation carried over unchanged - not
  // something this orchestrator regresses or is expected to fix.
  assert.equal(result.offers[0].shippingKnown, false);
});

test("scanBookOnFindabook: no title match returns not_found", async () => {
  const { scanBookOnFindabook } = await scanner();
  const fetchImpl = mockFetch([
    ["findabook.co.il/result", REAL_FINDABOOK_SEARCH_HTML],
  ]);
  const result = await scanBookOnFindabook(
    { title: "ספר שלא קיים בכלל", author: "" },
    { fetchImpl },
  );
  assert.equal(result.status, "not_found");
});
