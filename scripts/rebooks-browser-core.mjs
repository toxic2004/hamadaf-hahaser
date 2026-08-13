const REBOOKS_ORIGIN = "https://rebooks.org.il";

export function normalizeBookText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0591-\u05c7]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("he-IL");
}

export function isDirectRebooksProductUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.origin === REBOOKS_ORIGIN &&
      /^\/product\/[^/]+\/?$/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function titleMatches(wantedTitle, listingTitle) {
  const wanted = normalizeBookText(wantedTitle);
  const listing = normalizeBookText(listingTitle);
  if (!wanted || !listing) return false;
  return listing === wanted || listing.startsWith(`${wanted} חלק `);
}

export function authorMatches(wantedAuthor, listingAuthor) {
  const wanted = normalizeBookText(wantedAuthor);
  if (!wanted) return true;
  const listing = normalizeBookText(listingAuthor);
  if (!listing) return false;
  if (listing === wanted) return true;
  const previous = Array.from(
    { length: listing.length + 1 },
    (_, index) => index,
  );
  for (let wantedIndex = 1; wantedIndex <= wanted.length; wantedIndex += 1) {
    let diagonal = previous[0];
    previous[0] = wantedIndex;
    for (
      let listingIndex = 1;
      listingIndex <= listing.length;
      listingIndex += 1
    ) {
      const oldValue = previous[listingIndex];
      const substitution =
        diagonal +
        (wanted[wantedIndex - 1] === listing[listingIndex - 1] ? 0 : 1);
      previous[listingIndex] = Math.min(
        previous[listingIndex] + 1,
        previous[listingIndex - 1] + 1,
        substitution,
      );
      diagonal = oldValue;
    }
  }
  return previous[listing.length] <= 1;
}

export function parsePrice(value) {
  const matches = [
    ...String(value || "").matchAll(
      /(?:₪\s*(\d{1,4}(?:[.,]\d{1,2})?)|(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:₪|ש[״"']?ח))/gu,
    ),
  ];
  const prices = matches
    .map((match) => Number(String(match[1] || match[2]).replace(",", ".")))
    .filter((price) => Number.isFinite(price) && price > 0 && price < 5000);
  return prices.length ? prices.at(-1) : null;
}

export function availabilityFromProductText(text, hasAddToCart) {
  const value = String(text || "");
  if (/לרישום\s+למלאי|אזל\s+מהמלאי|המלאי\s+אזל/u.test(value)) return "לא במלאי";
  if (hasAddToCart && /(?:רק\s+\d+\s+במלאי|במלאי)/u.test(value)) return "במלאי";
  return null;
}

export function fulfillmentOptionsFromText(text) {
  const value = String(text || "");
  const options = [];
  if (/איסוף\s+עצמי\s*[–-]?\s*חינם/u.test(value)) {
    options.push({ type: "איסוף עצמי", price: 0, locations: [] });
  }
  const pickupPoint = value.match(
    /נקודת\s+(?:חלוקה|איסוף)\s*[–-]?\s*(\d+(?:[.,]\d+)?)\s*ש[״"']?ח/u,
  );
  if (pickupPoint) {
    options.push({
      type: "נקודת חלוקה",
      price: Number(pickupPoint[1].replace(",", ".")),
      locations: [],
    });
  }
  const homeDelivery = value.match(
    /שליח\s+עד\s+הבית\s*[–-]?\s*(\d+(?:[.,]\d+)?)\s*ש[״"']?ח/u,
  );
  if (homeDelivery) {
    options.push({
      type: "שליח עד הבית",
      price: Number(homeDelivery[1].replace(",", ".")),
      locations: [],
    });
  }
  return options;
}

export function mergePickupLocations(options, locations) {
  const cleanLocations = [
    ...new Set(
      (locations || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ];
  return options.map((option) =>
    option.type === "איסוף עצמי"
      ? { ...option, locations: cleanLocations }
      : option,
  );
}

export function reportableFulfillmentOptions(itemPrice, options, limit = 30) {
  if (!Number.isFinite(itemPrice) || itemPrice <= 0) return [];
  return (options || [])
    .map((option) => ({
      ...option,
      totalPrice: itemPrice + Number(option.price),
    }))
    .filter(
      (option) =>
        Number.isFinite(option.price) &&
        option.price >= 0 &&
        option.totalPrice <= limit,
    );
}

export function validateConcreteOffer(offer, limit = 30) {
  if (!titleMatches(offer?.wantedTitle, offer?.listingTitle)) return false;
  if (!authorMatches(offer?.wantedAuthor, offer?.listingAuthor)) return false;
  if (!isDirectRebooksProductUrl(offer?.productUrl)) return false;
  if (!Number.isFinite(offer?.itemPrice) || offer.itemPrice <= 0) return false;
  if (!["במלאי", "לא במלאי"].includes(offer?.availability)) return false;
  if (offer.availability !== "במלאי") return true;
  return (
    reportableFulfillmentOptions(
      offer.itemPrice,
      offer.fulfillmentOptions,
      limit,
    ).length > 0
  );
}
