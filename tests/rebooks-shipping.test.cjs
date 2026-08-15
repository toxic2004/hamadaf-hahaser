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
  assert.deepEqual(best, { price: 15, method: "distributionPoint" });
});

test("bestKnownShipping falls back to courier when no distribution point price exists", async () => {
  const { bestKnownShipping } = await scanner();
  const best = bestKnownShipping({ pickup: null, courier: { price: 39 }, distributionPoint: null });
  assert.deepEqual(best, { price: 39, method: "courier" });
});

test("bestKnownShipping never uses self-pickup automatically (branch location not verified by this fix)", async () => {
  const { bestKnownShipping } = await scanner();
  const best = bestKnownShipping({ pickup: { price: 0 }, courier: null, distributionPoint: null });
  assert.equal(best, null);
});

test("this exact block matches the total_price=35 already observed for מי הזיז את הגבינה שלי in production", async () => {
  const { extractShippingOptions, bestKnownShipping } = await scanner();
  const options = extractShippingOptions(REAL_SHIPPING_BLOCK_HTML);
  const best = bestKnownShipping(options);
  const itemPrice = 20;
  assert.equal(itemPrice + best.price, 35);
});
