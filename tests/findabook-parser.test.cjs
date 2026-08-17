const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

async function scanner() {
  return import(path.join(root, "supabase/functions/alerts/scanner-core.mjs"));
}

// Real search-results card, sampled verbatim from findabook.co.il/result
// (2026-08-17, confirmed live and unblocked directly from Supabase's own
// IP via net.http_get - status 200, not 403 like every other automatic
// source checked that day).
const REAL_FINDABOOK_SEARCH_HTML = `
  <li><figure>
  <a class="hover-text" href="https://www.findabook.co.il/book/583166/הליכת-אקראי-בוול-סטריטברטון-גימלכיאל"><span>לחצו לפרטים</span></a>
  <a href="https://www.findabook.co.il/book/583166/הליכת-אקראי-בוול-סטריטברטון-גימלכיאל"><img src="..."></a>
  </figure><h3>הליכת אקראי בוול סטריט/ברטון ג'י.מלכיאל</h3><ul><li class="strong">98 ₪ </li></ul>
  <p><a href="https://www.findabook.co.il/book/583166/הליכת-אקראי-בוול-סטריטברטון-גימלכיאל" class="btn">רכישה ישירה</a></p></li>
  <li><figure>
  <a class="hover-text" href="https://www.findabook.co.il/book/999999/ספר-אחר-לגמרי"><span>לחצו לפרטים</span></a>
  </figure><h3>ספר אחר לגמרי/מחבר אחר</h3><ul><li class="strong">40 ₪ </li></ul></li>
`;

test("extractFindabookOffer matches a title concatenated with author, ignores an unrelated card", async () => {
  const { extractFindabookOffer } = await scanner();
  const offer = extractFindabookOffer(
    REAL_FINDABOOK_SEARCH_HTML,
    "הליכת אקראי בוול סטריט",
  );
  assert.equal(offer.itemPrice, 98);
  assert.equal(
    offer.sourceUrl,
    "https://www.findabook.co.il/book/583166/הליכת-אקראי-בוול-סטריטברטון-גימלכיאל",
  );
});

test("extractFindabookOffer does not match a short title against an unrelated longer one", async () => {
  const { extractFindabookOffer } = await scanner();
  const offer = extractFindabookOffer(REAL_FINDABOOK_SEARCH_HTML, "ספר");
  assert.equal(offer, null);
});

test("extractFindabookOffer returns null when no card matches at all", async () => {
  const { extractFindabookOffer } = await scanner();
  const offer = extractFindabookOffer(
    REAL_FINDABOOK_SEARCH_HTML,
    "כותר שלא קיים בדף",
  );
  assert.equal(offer, null);
});

test("findabookAvailability always returns במלאי (peer-marketplace inference, documented)", async () => {
  const { findabookAvailability } = await scanner();
  assert.equal(findabookAvailability(), "במלאי");
});

// Real per-seller shipping text, sampled verbatim from two different real
// product pages (2026-08-17).
test("extractFindabookShipping reads an explicit seller-stated cost", async () => {
  const { extractFindabookShipping } = await scanner();
  const html = `<div>ניתן לאסוף את הספרים בביתי במבשרת ציון. עלות שליחת הספר בדואר 15.9 (דואר רשום) ניתן לשלם בPAYPAL</div>`;
  const shipping = extractFindabookShipping(html);
  assert.deepEqual(shipping, { price: 15.9, method: "sellerStated" });
});

test("extractFindabookShipping recognizes the (המחיר כולל משלוח) tag as zero additional cost", async () => {
  const { extractFindabookShipping } = await scanner();
  const html = `<div>תורת המשחקים (כחדש, המחיר כולל משלוח)</div>`;
  const shipping = extractFindabookShipping(html);
  assert.deepEqual(shipping, { price: 0, method: "includedInPrice" });
});

test("extractFindabookShipping returns null (never guesses) when the seller's terms don't match either known pattern", async () => {
  const { extractFindabookShipping } = await scanner();
  const html = `<div>ניתן לתאם איתי טלפונית לגבי אופן המסירה</div>`;
  assert.equal(extractFindabookShipping(html), null);
});
