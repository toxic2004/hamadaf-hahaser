const assert = require("node:assert/strict");
const test = require("node:test");

let core;

test.before(async () => {
  core = await import("../scripts/rebooks-browser-core.mjs");
});

test("accepts direct Sipur Hozer product links only", () => {
  assert.equal(
    core.isDirectRebooksProductUrl("https://rebooks.org.il/product/example/"),
    true,
  );
  assert.equal(
    core.isDirectRebooksProductUrl("https://rebooks.org.il/?s=example"),
    false,
  );
  assert.equal(
    core.isDirectRebooksProductUrl("https://example.com/product/example/"),
    false,
  );
});

test("matches an exact title and a numbered part", () => {
  assert.equal(
    core.titleMatches("להעיר את הענק שבפנים", "להעיר את הענק שבפנים חלק 1"),
    true,
  );
  assert.equal(core.titleMatches("הסוד", "סודות ההצלחה"), false);
});

test("requires the wanted author when one is known", () => {
  assert.equal(core.authorMatches("רונדה בירן", "רונדה בירן"), true);
  assert.equal(core.authorMatches("רונדה ביירן", "רונדה בירן"), true);
  assert.equal(core.authorMatches("רונדה בירן", "הרולד רובינס"), false);
  assert.equal(core.authorMatches("", "הרולד רובינס"), true);
});

test("reads the current sale price from the add button", () => {
  assert.equal(core.parsePrice("הוספה לסל - ₪25 ₪20"), 20);
  assert.equal(core.parsePrice("אור עם, 1998"), null);
});

test("distinguishes in stock from registration for stock", () => {
  assert.equal(core.availabilityFromProductText("רק 1 במלאי", true), "במלאי");
  assert.equal(
    core.availabilityFromProductText("לרישום למלאי", false),
    "לא במלאי",
  );
});

test("keeps only fulfillment options with a total up to 30 shekels", () => {
  const options = core.fulfillmentOptionsFromText(`
    איסוף עצמי - חינם
    נקודת חלוקה - 15 ש"ח
    שליח עד הבית - 39 ש"ח
  `);
  assert.deepEqual(core.reportableFulfillmentOptions(20, options), [
    { type: "איסוף עצמי", price: 0, locations: [], totalPrice: 20 },
  ]);
});

test("preserves all pickup locations when the site exposes them", () => {
  assert.deepEqual(
    core.mergePickupLocations(
      [{ type: "איסוף עצמי", price: 0, locations: [] }],
      ["פתח תקווה", "בני ברק", "פתח תקווה"],
    ),
    [
      {
        type: "איסוף עצמי",
        price: 0,
        locations: ["פתח תקווה", "בני ברק"],
      },
    ],
  );
});

test("rejects an in stock offer without an affordable known option", () => {
  assert.equal(
    core.validateConcreteOffer({
      wantedTitle: "הסוד",
      wantedAuthor: "רונדה בירן",
      listingTitle: "הסוד",
      listingAuthor: "רונדה בירן",
      productUrl: "https://rebooks.org.il/product/hasod/",
      itemPrice: 25,
      availability: "במלאי",
      fulfillmentOptions: [{ type: "שליח עד הבית", price: 39, locations: [] }],
    }),
    false,
  );
});
