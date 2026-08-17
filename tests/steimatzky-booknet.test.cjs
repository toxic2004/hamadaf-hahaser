const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

async function scanner() {
  return import(path.join(root, "supabase/functions/alerts/scanner-core.mjs"));
}

// === Booknet / Tzomet Sfarim ===
// Real card structure sampled from the actual live product page
// (2026-08-16) - both the main product's own price block ("מחיר באתר")
// and the related-items strip's card template ("מחיר נוכחי").
const REAL_BOOKNET_HTML = `
  <a href="https://www.booknet.co.il/מוצרים/אנטי-שביר-100026207">אנטי שביר אנטי שביר</a>
  <a href="https://www.booknet.co.il/מחברים/טאלב-ניקולס-נסים">ניקולס נסים טאלב</a>
  מחיר מכירה מודפס ==96 ₪==
  אנטי שביר, ניקולס נסים טאלב, מחיר נוכחי: 96 שח,מחיר קודם: 96 שח  הוסף לסל
  <a href="https://www.booknet.co.il/מוצרים/חשיפה-לסיכון-100068771">חשיפה לסיכון חשיפה לסיכון</a>
  מחיר מכירה מודפס ==98 ₪==
  חשיפה לסיכון, ניקולס נסים טאלב, מחיר נוכחי: 98 שח,מחיר קודם: 98 שח  הוסף לסל
`;

test("extractBooknetOffer reads the exact real price and URL for the matching title", async () => {
  const { extractBooknetOffer } = await scanner();
  const offer = extractBooknetOffer(REAL_BOOKNET_HTML, "אנטי שביר");
  assert.equal(offer.itemPrice, 96);
  assert.equal(offer.availabilityStatus, "במלאי");
  assert.equal(
    offer.sourceUrl,
    "https://www.booknet.co.il/מוצרים/אנטי-שביר-100026207",
  );
});

test("extractBooknetOffer distinguishes between two different books' prices on the same page", async () => {
  const { extractBooknetOffer } = await scanner();
  const offer = extractBooknetOffer(REAL_BOOKNET_HTML, "חשיפה לסיכון");
  assert.equal(offer.itemPrice, 98);
});

test("extractBooknetOffer returns null when the title is not on the page at all", async () => {
  const { extractBooknetOffer } = await scanner();
  assert.equal(extractBooknetOffer(REAL_BOOKNET_HTML, "ספר לא קיים"), null);
});

test("extractBooknetOffer marks out of stock when there is no הוסף לסל control", async () => {
  const { extractBooknetOffer } = await scanner();
  const html = `<a href="https://www.booknet.co.il/מוצרים/ספר-לדוגמה">ספר לדוגמה</a> מחיר נוכחי: 50 שח, אזל מהמלאי`;
  const offer = extractBooknetOffer(html, "ספר לדוגמה");
  assert.equal(offer.availabilityStatus, "לא במלאי");
});

test("booknetShipping always resolves to free self-pickup (fixed, always-approved location in Ramla)", async () => {
  const { booknetShipping } = await scanner();
  assert.deepEqual(booknetShipping(), { price: 0, method: "pickup" });
});

// === Steimatzky ===
// Real og:product:price:amount meta tag format, and the real ambiguous
// digital-price block, both sampled from an actual live product page
// (2026-08-16) that turned out to be a mixed print/digital title.
const REAL_STEIMATZKY_AMBIGUOUS_HTML = `
  <html><head>
  <meta property="og:product:price:amount" content="69.0000" />
  </head><body>
  <div>ספר דיגיטלי</div>
  <div>מחיר מוצר 35.00 ₪ מחיר מדף 0.00 ₪</div>
  <div>ניתן לקריאה בקינדל</div>
  <button>הוספה לסל</button>
  </body></html>
`;

const REAL_STEIMATZKY_UNAMBIGUOUS_HTML = `
  <html><head>
  <meta property="og:product:price:amount" content="96.0000" />
  </head><body>
  <div>הוספה לסל</div>
  </body></html>
`;

test("extractSteimatzkyOffer refuses to guess when a conflicting digital price block exists (the real ambiguous case found live)", async () => {
  const { extractSteimatzkyOffer } = await scanner();
  assert.equal(extractSteimatzkyOffer(REAL_STEIMATZKY_AMBIGUOUS_HTML), null);
});

test("extractSteimatzkyOffer trusts the meta price when there is no conflicting digital block", async () => {
  const { extractSteimatzkyOffer } = await scanner();
  const offer = extractSteimatzkyOffer(REAL_STEIMATZKY_UNAMBIGUOUS_HTML);
  assert.deepEqual(offer, { itemPrice: 96, availabilityStatus: "במלאי" });
});

test("extractSteimatzkyOffer marks out of stock using the real חסר זמנית marker", async () => {
  const { extractSteimatzkyOffer } = await scanner();
  const html = `<meta property="og:product:price:amount" content="50.00" /><div>חסר זמנית</div>`;
  const offer = extractSteimatzkyOffer(html);
  assert.equal(offer.availabilityStatus, "לא במלאי");
});

test("extractSteimatzkyOffer returns null when there is no price meta tag at all", async () => {
  const { extractSteimatzkyOffer } = await scanner();
  assert.equal(extractSteimatzkyOffer("<html><body>no price here</body></html>"), null);
});

test("extractSteimatzkyProductLink finds the real 9-digit product URL pattern", async () => {
  const { extractSteimatzkyProductLink } = await scanner();
  const html = `<a href="/012010227">מושיע מושחת 2 מחיר החטא 2</a>`;
  const url = extractSteimatzkyProductLink(html, "מושיע מושחת 2 מחיר החטא 2");
  assert.equal(url, "/012010227");
});

test("steimatzkyShipping always resolves to the real cheapest published option (registered mail, 10 ₪)", async () => {
  const { steimatzkyShipping } = await scanner();
  assert.deepEqual(steimatzkyShipping(), { price: 10, method: "registeredMail" });
});
