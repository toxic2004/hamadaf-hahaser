import assert from "node:assert/strict";
import test from "node:test";
import {
  isDirectRebooksProductUrl,
  reportableOptions,
  validateOffer,
} from "../src/core.mjs";

test("accepts only a direct Sipur Hozer product URL", () => {
  assert.equal(
    isDirectRebooksProductUrl("https://rebooks.org.il/product/example/"),
    true,
  );
  assert.equal(
    isDirectRebooksProductUrl("https://rebooks.org.il/?s=example"),
    false,
  );
});

test("keeps only fulfillment options with a total up to 30 ILS", () => {
  assert.deepEqual(
    reportableOptions(20, [
      { type: "איסוף עצמי", price: 0, locations: [] },
      { type: "נקודת חלוקה", price: 15, locations: [] },
    ]),
    [
      {
        type: "איסוף עצמי",
        price: 0,
        locations: [],
        totalPrice: 20,
      },
    ],
  );
});

test("requires price, direct link, availability and an affordable option", () => {
  assert.equal(
    validateOffer({
      wantedTitle: "להעיר את הענק שבפנים",
      wantedAuthor: "אנתוני רובינס",
      listingTitle: "להעיר את הענק שבפנים חלק 1",
      listingAuthor: "אנתוני רובינס",
      productUrl: "https://rebooks.org.il/product/example/",
      itemPrice: 20,
      availability: "במלאי",
      fulfillmentOptions: [
        { type: "איסוף עצמי", price: 0, locations: [] },
      ],
    }),
    true,
  );
});
