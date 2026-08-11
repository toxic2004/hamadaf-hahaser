const test = require("node:test");
const assert = require("node:assert/strict");
const report = require("../report-core.js");

test("unknown shipping never wins a ranked place", () => {
  const result = report.rankBookOffers([
    {
      id: "unknown",
      item_price: 5,
      shipping_known: false,
      match_type: "מדויקת",
      edition_language: "עברית",
      active: true,
    },
    {
      id: "known",
      item_price: 20,
      shipping_price: 5,
      shipping_known: true,
      match_type: "מדויקת",
      edition_language: "עברית",
      active: true,
    },
  ]);
  assert.deepEqual(
    result.ranked.map((item) => item.id),
    ["known"],
  );
  assert.deepEqual(
    result.unknownShipping.map((item) => item.id),
    ["unknown"],
  );
});

test("only three exact Hebrew active offers are ranked", () => {
  const offers = [40, 10, 30, 20].map((price, index) => ({
    id: String(index),
    item_price: price,
    shipping_price: 0,
    shipping_known: true,
    match_type: "מדויקת",
    edition_language: "עברית",
    active: true,
  }));
  offers.push({
    id: "similar",
    item_price: 1,
    shipping_price: 0,
    shipping_known: true,
    match_type: "דומה",
    edition_language: "עברית",
    active: true,
  });
  const result = report.rankBookOffers(offers);
  assert.deepEqual(
    result.ranked.map((item) => item.item_price),
    [10, 20, 30],
  );
  assert.equal(result.alternatives[0].id, "similar");
});

test("coverage is complete only when every expected check has a terminal status", () => {
  const partial = report.coverageSummary(
    [{ status: "found" }, { status: "pending" }],
    2,
  );
  assert.equal(partial.percent, 50);
  assert.equal(partial.complete, false);
  const complete = report.coverageSummary(
    [{ status: "found" }, { status: "manual_required" }],
    2,
  );
  assert.equal(complete.percent, 100);
  assert.equal(complete.complete, true);
});

test("a temporary source error remains pending until retry exhaustion", () => {
  const result = report.coverageSummary(
    [{ status: "found" }, { status: "temporary_error" }],
    2,
  );
  assert.equal(result.completed, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.complete, false);
});
