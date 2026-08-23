const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

async function scanner() {
  return import(path.join(root, "supabase/functions/alerts/scanner-core.mjs"));
}

// Sampled structure from an actual Rebooks product page (2026-08-15), with
// surrounding markup simplified but the real Hebrew labels and prices kept
// exact, since the extractor matches on those labels.
const REAL_SHIPPING_BLOCK_HTML = `
  <div class="shipping-options">
    <h4><strong>איסוף עצמי – חינם</strong></h4>
    <p>אפשרי רק מהסניף ממנו הוזמן הספר, ואם כל הספרים בסל מאותו סניף</p>
    <h4><strong>שליח עד הבית – 39 ש״ח</strong></h4>
    <p>אספקה עד 15 ימי עסקים. לחבילה של עד 10 ספרים (או 5 ק"ג), מעל כמות זו יגבו דמי משלוח נוספים</p>
    <h4><strong>נקודת חלוקה – 15 ש״ח</strong></h4>
    <p>אספקה עד 15 ימי עסקים. במידה והספרים מסניפים שונים זמן האספקה עשוי להתארך</p>
  </div>
`;

test("extractShippingOptions reads all three real shipping options with exact prices", async () => {
  const { extractShippingOptions } = await scanner();
  const options = extractShippingOptions(REAL_SHIPPING_BLOCK_HTML);
  assert.deepEqual(options.pickup, { price: 0 });
  assert.deepEqual(options.courier, { price: 39 });
  assert.deepEqual(options.distributionPoint, { price: 15 });
});

test("extractShippingOptions returns null options when the block is absent", async () => {
  const { extractShippingOptions } = await scanner();
  const options = extractShippingOptions("<div>אין כאן שום מידע משלוח</div>");
  assert.equal(options.pickup, null);
  assert.equal(options.courier, null);
  assert.equal(options.distributionPoint, null);
});

test("bestKnownShipping prefers distribution point over courier (nationwide, not branch-dependent)", async () => {
  const { extractShippingOptions, bestKnownShipping } = await scanner();
  const options = extractShippingOptions(REAL_SHIPPING_BLOCK_HTML);
  const best = bestKnownShipping(options);
  assert.equal(best.price, 15);
  assert.equal(best.method, "distributionPoint");
  assert.equal(best.allOptions.distributionPrice, 15);
});

test("bestKnownShipping falls back to courier when no distribution point price exists", async () => {
  const { bestKnownShipping } = await scanner();
  const best = bestKnownShipping({
    pickup: null,
    courier: { price: 39 },
    distributionPoint: null,
  });
  assert.deepEqual(best, {
    price: 39,
    method: "courier",
    allOptions: {
      pickupPrice: null,
      pickupApproved: null,
      distributionPrice: null,
      courierPrice: 39,
    },
  });
});

test("bestKnownShipping never uses self-pickup automatically (branch location not verified by this fix)", async () => {
  const { bestKnownShipping } = await scanner();
  const best = bestKnownShipping({
    pickup: { price: 0 },
    courier: null,
    distributionPoint: null,
  });
  assert.equal(best, null);
});

test("this exact block matches the total_price=35 already observed for מי הזיז את הגבינה שלי in production", async () => {
  const { extractShippingOptions, bestKnownShipping } = await scanner();
  const options = extractShippingOptions(REAL_SHIPPING_BLOCK_HTML);
  const best = bestKnownShipping(options);
  const itemPrice = 20;
  assert.equal(itemPrice + best.price, 35);
});

// Real branch-availability block, sampled from the actual product page
// fetched during the 2026-08-15 audit.
const REAL_BRANCH_AVAILABILITY_HTML = `
  <h3>זמינות המוצר בסניפים</h3>
  <p>שימו לב – כאן תוכלו לראות באיזה סניף נמצא הספר.</p>
  <div class="branch-item"><a href="#">סניף חדרה</a>
    <p><strong>שעות פעילות:</strong> ימים ראשון, שני, רביעי, חמישי 08:30-19:30</p>
  </div>
  <div class="branch-item"><a href="#">סניף חולון (מרכז הזמנות חולון- איסוף עצמי בלבד)</a>
    <p><strong>שעות פעילות:</strong> ראשון-חמישי 08:30-13:30</p>
  </div>
`;

test("extractAvailableBranches reads branch names from the real availability block", async () => {
  const { extractAvailableBranches } = await scanner();
  const branches = extractAvailableBranches(REAL_BRANCH_AVAILABILITY_HTML);
  assert.ok(branches.some((name) => name.includes("חדרה")));
  assert.ok(branches.some((name) => name.includes("חולון")));
});

test("extractAvailableBranches returns an empty list when the section is absent", async () => {
  const { extractAvailableBranches } = await scanner();
  assert.deepEqual(extractAvailableBranches("<div>שום מידע כאן</div>"), []);
});

test("isApprovedPickupBranch matches every city confirmed with the user, and rejects excluded/unrelated ones", async () => {
  const { isApprovedPickupBranch } = await scanner();
  const approved = [
    "פתח תקווה",
    "תל אביב",
    "תל אביב - איכילוב",
    "רמת גן",
    "גבעתיים",
    "ראשון לציון",
    "חולון (מרכז הזמנות חולון- איסוף עצמי בלבד)",
    "רחובות",
    "רמלה",
    "כפר סבא",
    "ירושלים",
    "ירושלים מאה שערים",
    "נתניה",
  ];
  for (const city of approved) {
    assert.ok(
      isApprovedPickupBranch(city),
      `expected "${city}" to be approved`,
    );
  }
  const rejected = ["חדרה", "יבנה", "חיפה", "אשדוד", "באר שבע", "עכו", "נשר"];
  for (const city of rejected) {
    assert.ok(
      !isApprovedPickupBranch(city),
      `expected "${city}" to be rejected`,
    );
  }
});

test("bestKnownShipping picks free pickup over paid options when an approved branch carries the book", async () => {
  const { extractShippingOptions, bestKnownShipping } = await scanner();
  const options = extractShippingOptions(REAL_SHIPPING_BLOCK_HTML);
  const best = bestKnownShipping(options, ["סניף פתח תקווה"]);
  assert.equal(best.price, 0);
  assert.equal(best.method, "pickup");
  assert.equal(best.allOptions.pickupApproved, true);
});

test("bestKnownShipping ignores pickup when only non-approved branches carry the book, falling back to distribution point", async () => {
  const { extractShippingOptions, bestKnownShipping } = await scanner();
  const options = extractShippingOptions(REAL_SHIPPING_BLOCK_HTML);
  const best = bestKnownShipping(options, ["סניף חדרה", "סניף יבנה"]);
  assert.equal(best.price, 15);
  assert.equal(best.method, "distributionPoint");
  assert.equal(best.allOptions.pickupApproved, false);
});
