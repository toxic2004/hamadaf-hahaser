const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

async function scanner() {
  return import(path.join(root, "supabase/functions/alerts/scanner-core.mjs"));
}

// Real product-grid card structure (2026-08-15), same shape used by the
// existing extractSourceOffers tests - kept minimal here since that
// extraction logic is already covered elsewhere; this file focuses on the
// new orchestration (scanBookOnRebooks) and the save payload.
function searchPageHtml({ title, inStock = true }) {
  return `
    <div class="product-grid-item" data-id="12345" class="${inStock ? "instock" : "outofstock"}">
      <h3 class="wd-entities-title"><a href="https://rebooks.org.il/product/x-12345/">${title}</a></h3>
      <span class="woocommerce-Price-amount"><bdi>20.00&nbsp;₪</bdi></span>
      ${inStock ? "" : "אזל מהמלאי"}
    </div>
  `;
}

function fakeFetch(routes) {
  return async (url) => {
    const match = routes.find((route) => route.test(String(url)));
    if (!match) {
      return {
        ok: false,
        status: 404,
        headers: new Map(),
        text: async () => "",
      };
    }
    return {
      ok: match.status >= 200 && match.status < 300,
      status: match.status,
      headers: {
        get: (key) =>
          key.toLowerCase() === "content-type"
            ? "text/html; charset=utf-8"
            : null,
      },
      text: async () => match.body,
    };
  };
}

test("scanBookOnRebooks returns no offers when the title is not found on the search page", async () => {
  const { scanBookOnRebooks } = await scanner();
  const fetchImpl = fakeFetch([
    {
      test: (u) => u.includes("rebooks.org.il/?s="),
      status: 200,
      body: "<html>אין תוצאות</html>",
    },
  ]);
  const result = await scanBookOnRebooks(
    { title: "ספר שלא קיים", author: null },
    { fetchImpl },
  );
  assert.equal(result.status, "not_found");
  assert.deepEqual(result.offers, []);
});

test("scanBookOnRebooks: regression for the מי הזיז את הגבינה שלי bug - pickup free but branch unapproved must NOT make shipping known/zero", async () => {
  const { scanBookOnRebooks, buildPriceOfferPayload } = await scanner();
  const title = "מי הזיז את הגבינה שלי";
  const productHtml = `
    <div>
      <div class="shipping-options">
        <h4><strong>איסוף עצמי – חינם</strong></h4>
        <h4><strong>נקודת חלוקה – 15 ש״ח</strong></h4>
      </div>
      <div>זמינות המוצר בסניפים סניף אשדוד</div>
    </div>
  `;
  const fetchImpl = fakeFetch([
    {
      test: (u) => u.includes("rebooks.org.il/?s="),
      status: 200,
      body: searchPageHtml({ title }),
    },
    {
      test: (u) => u.includes("/product/x-12345/"),
      status: 200,
      body: productHtml,
    },
  ]);
  const result = await scanBookOnRebooks(
    { title, author: null },
    { fetchImpl },
  );
  assert.equal(result.status, "found");
  assert.equal(result.offers.length, 1);
  const offer = result.offers[0];
  // Ashdod is not in the approved pickup list, so pickup must be rejected
  // and distributionPoint (15) used instead - never a fake 0.
  assert.equal(offer.shippingKnown, true);
  assert.equal(offer.shippingPrice, 15);
  const payload = buildPriceOfferPayload(
    { id: "book-1", user_id: "user-1" },
    offer,
  );
  assert.equal(payload.shipping_price, 15);
  assert.equal(payload.shipping_known, true);
  assert.equal(
    "total_price" in payload,
    false,
    "total_price must never be set directly - it is DB-generated",
  );
});

test("scanBookOnRebooks: pickup IS used when the carrying branch is approved", async () => {
  const { scanBookOnRebooks } = await scanner();
  const title = "הרגלים אטומיים";
  const productHtml = `
    <div class="shipping-options">
      <h4><strong>איסוף עצמי – חינם</strong></h4>
      <h4><strong>נקודת חלוקה – 15 ש״ח</strong></h4>
    </div>
    <div>זמינות המוצר בסניפים סניף פתח תקווה</div>
  `;
  const fetchImpl = fakeFetch([
    {
      test: (u) => u.includes("rebooks.org.il/?s="),
      status: 200,
      body: searchPageHtml({ title }),
    },
    {
      test: (u) => u.includes("/product/x-12345/"),
      status: 200,
      body: productHtml,
    },
  ]);
  const result = await scanBookOnRebooks(
    { title, author: null },
    { fetchImpl },
  );
  assert.equal(result.offers[0].shippingKnown, true);
  assert.equal(result.offers[0].shippingPrice, 0);
});

test("scanBookOnRebooks: regression for the המיליונר מהדלת ממול bug - no explicit stock marker means the offer is dropped, not stored as active", async () => {
  const { scanBookOnRebooks } = await scanner();
  const title = "ספר בלי סטטוס מלאי מפורש";
  // No 'instock'/'outofstock' class and no 'במלאי'/'אזל' text anywhere in
  // the card - extractSourceOffers must refuse to guess.
  const ambiguousHtml = `
    <div class="product-grid-item" data-id="999">
      <h3 class="wd-entities-title"><a href="https://rebooks.org.il/product/y-999/">${title}</a></h3>
      <span class="woocommerce-Price-amount"><bdi>45.00&nbsp;₪</bdi></span>
    </div>
  `;
  const fetchImpl = fakeFetch([
    {
      test: (u) => u.includes("rebooks.org.il/?s="),
      status: 200,
      body: ambiguousHtml,
    },
  ]);
  const result = await scanBookOnRebooks(
    { title, author: null },
    { fetchImpl },
  );
  assert.equal(result.offers.length, 0);
});

test("scanBookOnRebooks: network failure returns temporary_error, never invents an offer", async () => {
  const { scanBookOnRebooks } = await scanner();
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  const result = await scanBookOnRebooks(
    { title: "כל ספר", author: null },
    { fetchImpl },
  );
  assert.equal(result.status, "temporary_error");
  assert.deepEqual(result.offers, []);
});

test("buildPriceOfferPayload marks active=false when the offer is explicitly out of stock", async () => {
  const { buildPriceOfferPayload } = await scanner();
  const payload = buildPriceOfferPayload(
    { id: "book-1", user_id: "user-1" },
    {
      source: "סיפור חוזר",
      sourceListingKey: "1",
      listingTitle: "כל ספר",
      sourceUrl: "https://rebooks.org.il/product/x/",
      condition: "יד שנייה",
      matchType: "מדויקת",
      editionLanguage: "עברית",
      itemPrice: 20,
      availabilityStatus: "לא במלאי",
      shippingKnown: true,
      shippingPrice: 15,
    },
  );
  assert.equal(payload.active, false);
});
