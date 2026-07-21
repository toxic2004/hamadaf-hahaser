const test = require("node:test");
const assert = require("node:assert/strict");
const prices = require("../price-utils.js");

test("accepts only HTTP links for external offers", () => {
  assert.match(prices.httpUrl("https://example.com/ad?id=1"), /^https:\/\//);
  assert.equal(prices.httpUrl("javascript:alert(1)"), "");
  assert.equal(prices.httpUrl("not a url"), "");
});

test("keeps shipping separate and ranks only known totals", () => {
  const known = { item_price: 40, shipping_price: 10, shipping_known: true };
  const unknown = {
    item_price: 25,
    shipping_price: null,
    shipping_known: false,
  };
  assert.equal(prices.totalPrice(known), 50);
  assert.equal(prices.totalPrice(unknown), null);
  assert.equal(prices.compareOffers(known, unknown), -1);
});

test("deal formula is transparent and rejects English editions", () => {
  const fresh = new Date().toISOString();
  const deal = prices.calculateDeal({
    item_price: 25,
    shipping_price: 5,
    shipping_known: true,
    reference_new_price: 100,
    match_type: "מדויקת",
    edition_language: "עברית",
    active: true,
    last_checked_at: fresh,
  });
  assert.equal(deal.score, 100);
  assert.equal(deal.worthwhile, true);
  assert.equal(deal.reasons.length, 5);
  const english = prices.calculateDeal({ ...deal, edition_language: "אנגלית" });
  assert.equal(english.score, 0);
});

test("three cheapest offers and no-price offers stay separate", () => {
  const offers = [10, 20, 30, 40].map((price) => ({
    condition: "יד שנייה",
    item_price: price,
    shipping_price: 0,
    shipping_known: true,
    edition_language: "עברית",
    active: true,
  }));
  offers.push({
    condition: "יד שנייה",
    item_price: null,
    shipping_known: false,
    edition_language: "עברית",
    active: true,
  });
  const result = prices.splitRankedOffers(offers);
  assert.deepEqual(
    result.usedOffers.cheapest.map((offer) => offer.item_price),
    [10, 20, 30],
  );
  assert.equal(result.usedOffers.withoutPrice.length, 1);
});
