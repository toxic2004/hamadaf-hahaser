import { isDirectProductUrl } from "./core.mjs";

const SOURCE_PLANS = Object.freeze({
  yad2: {
    mode: "manual",
    note: "יד2 דורש דפדפן אינטראקטיבי. נוצר קישור חיפוש ולא נעשה ניסיון לעקוף את הגנות האתר.",
    url: (query) =>
      `https://www.yad2.co.il/market/collections/books?search=${query}`,
  },
  simania: {
    mode: "automatic",
    url: (query) => `https://simania.co.il/searchBooks.php?query=${query}`,
  },
  facebook_marketplace: {
    mode: "login",
    note: "Facebook Marketplace דורש כניסה. נוצר קישור לבדיקה ידנית.",
    url: (query) =>
      `https://www.facebook.com/marketplace/israel/search/?query=${query}`,
  },
  facebook_public: {
    mode: "login",
    note: "חיפוש פוסטים ב Facebook דורש כניסה ברוב המקרים. נוצר קישור לבדיקה ידנית.",
    url: (query) => `https://www.facebook.com/search/posts/?q=${query}`,
  },
  evrit: {
    mode: "automatic",
    url: (query) => `https://e-vrit.co.il/Search?query=${query}`,
  },
  steimatzky: {
    mode: "automatic",
    url: (query) =>
      `https://www.steimatzky.co.il/catalogsearch/result/?q=${query}`,
  },
  booknet: {
    mode: "automatic",
    url: (query) => `https://www.booknet.co.il/חיפוש?q=${query}`,
  },
  findabook: {
    mode: "automatic",
    url: (query) => `https://www.findabook.co.il/result?mainSearchText=${query}`,
  },
  sipur_hozer: {
    mode: "automatic",
    url: (query) => `https://rebooks.org.il/?s=${query}&post_type=product`,
  },
  rebooks: {
    mode: "automatic",
    note: "Rebooks הוא אתר סיפור חוזר. התוצאה נבדקת באותו קטלוג רשמי.",
    url: (query) => `https://rebooks.org.il/?s=${query}&post_type=product`,
  },
  independent_and_general: {
    mode: "manual",
    note: "אין ממשק חיפוש מרכזי מורשה לכל החנויות העצמאיות. נוצר חיפוש כללי לבדיקה ידנית.",
    url: (query) => `https://www.google.com/search?q=${query}+ספר`,
  },
});

const BLOCK_MARKERS = [
  "captcha",
  "access denied",
  "request blocked",
  "verify you are human",
  "בדיקת אבטחה",
];

const LOGIN_MARKERS = [
  "log in to facebook",
  "you must log in",
  "התחבר כדי להמשיך",
  "נדרשת התחברות",
];

export function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0591-\u05c7]/g, "")
    .replace(/&(?:nbsp|amp|quot|#39);/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("he-IL");
}

export function sourcePlan(sourceId, book) {
  const plan = SOURCE_PLANS[sourceId];
  if (!plan) {
    return {
      status: "unavailable",
      resultCount: 0,
      note: "המקור אינו מוגדר במנוע הסריקה.",
      searchUrl: null,
    };
  }
  const query = encodeURIComponent(
    [book?.title, book?.author].filter(Boolean).join(" "),
  );
  const searchUrl = plan.url(query);
  if (plan.mode === "login") {
    return {
      status: "login_required",
      resultCount: 0,
      note: plan.note,
      searchUrl,
    };
  }
  if (plan.mode === "manual") {
    return {
      status: "manual_required",
      resultCount: 0,
      note: plan.note,
      searchUrl,
    };
  }
  return { status: "pending", searchUrl, note: plan.note || null };
}

function containsMarker(text, markers) {
  const lower = text.toLocaleLowerCase("en-US");
  return markers.some((marker) => lower.includes(marker));
}

function pricesNearTitle(body, title) {
  const rawText = String(body || "").replace(/<[^>]+>/g, " ");
  const exactIndex = rawText
    .toLocaleLowerCase("he-IL")
    .indexOf(String(title || "").toLocaleLowerCase("he-IL"));
  if (exactIndex < 0) return [];
  const window = rawText.slice(
    Math.max(0, exactIndex - 250),
    exactIndex + title.length + 800,
  );
  const matches = [
    ...window.matchAll(/(?:₪\s*|)(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:₪|ש["״']?ח)/g),
  ];
  return [
    ...new Set(
      matches
        .map((match) => Number(match[1].replace(",", ".")))
        .filter((price) => Number.isFinite(price) && price > 0 && price < 5000),
    ),
  ].slice(0, 3);
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function textContent(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function priceFromProductCard(card) {
  const sale = card.match(
    /<ins\b[^>]*>[\s\S]*?<span\b[^>]*woocommerce-Price-amount[^>]*>[\s\S]*?<bdi\b[^>]*>([\s\S]*?)<\/bdi>/i,
  );
  const candidates = sale
    ? [sale[1]]
    : [
        ...card.matchAll(
          /<span\b[^>]*woocommerce-Price-amount[^>]*>[\s\S]*?<bdi\b[^>]*>([\s\S]*?)<\/bdi>/gi,
        ),
      ].map((match) => match[1]);
  for (const candidate of candidates.reverse()) {
    const amount = textContent(candidate).match(/(\d{1,4}(?:[.,]\d{1,2})?)/);
    const price = amount ? Number(amount[1].replace(",", ".")) : NaN;
    if (Number.isFinite(price) && price > 0 && price < 5000) return price;
  }
  return null;
}

export function extractSourceOffers({ sourceId, title, body }) {
  if (!["rebooks", "sipur_hozer"].includes(sourceId)) return [];
  const html = String(body || "");
  const markers = [
    ...html.matchAll(
      /<div\b[^>]*class=["'][^"']*product-grid-item[^"']*["'][^>]*data-id=["'](\d+)["'][^>]*>/gi,
    ),
  ];
  const wantedTitle = normalizeSearchText(title);
  const offers = new Map();
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const start = marker.index || 0;
    const end =
      markers[index + 1]?.index || Math.min(html.length, start + 12000);
    const card = html.slice(start, end);
    const isOutOfStock =
      /\boutofstock\b/i.test(marker[0]) || /אזל\s+מהמלאי/i.test(card);
    const isInStock =
      /\binstock\b/i.test(marker[0]) || /במלאי/i.test(card);
    if (!isOutOfStock && !isInStock) continue;
    const titleLink = card.match(
      /<h3\b[^>]*wd-entities-title[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!titleLink) continue;
    const listingTitle = textContent(titleLink[2]);
    if (!wantedTitle || normalizeSearchText(listingTitle) !== wantedTitle)
      continue;
    const itemPrice = priceFromProductCard(card);
    if (itemPrice === null) continue;
    const sourceUrl = decodeHtml(titleLink[1]);
    if (!isDirectProductUrl(sourceUrl)) continue;
    const listingKey = marker[1] || sourceUrl;
    offers.set(listingKey, {
      source: "סיפור חוזר",
      sourceListingKey: listingKey,
      listingTitle,
      sourceUrl,
      itemPrice,
      availabilityStatus: isOutOfStock ? "לא במלאי" : "במלאי",
      condition: "יד שנייה",
      matchType: "מדויקת",
      editionLanguage: "עברית",
      shippingKnown: false,
      shippingPrice: null,
    });
  }
  return [...offers.values()];
}

export function classifySearchResponse({
  sourceId,
  title,
  status,
  contentType,
  body,
}) {
  if (status === 401 || status === 403) {
    return {
      status: sourceId.startsWith("facebook") ? "login_required" : "blocked",
      resultCount: 0,
      note: `המקור החזיר HTTP ${status}.`,
    };
  }
  if (status === 408 || status === 429 || status >= 500) {
    return {
      status: "temporary_error",
      resultCount: 0,
      note: `תקלה זמנית במקור. HTTP ${status}.`,
    };
  }
  if (status === 404) {
    return { status: "not_found", resultCount: 0, note: "לא נמצאה תוצאה." };
  }
  if (status < 200 || status >= 400) {
    return {
      status: "unavailable",
      resultCount: 0,
      note: `המקור החזיר HTTP ${status}.`,
    };
  }
  if (
    !/(?:text\/html|text\/plain|application\/json)/i.test(contentType || "")
  ) {
    return {
      status: "unavailable",
      resultCount: 0,
      note: "המקור לא החזיר תוכן טקסט שניתן לבדיקה.",
    };
  }
  const text = String(body || "").slice(0, 1_500_000);
  if (containsMarker(text, BLOCK_MARKERS)) {
    return {
      status: "blocked",
      resultCount: 0,
      note: "המקור הציג חסימת גישה או בדיקת אבטחה.",
    };
  }
  if (containsMarker(text, LOGIN_MARKERS)) {
    return {
      status: "login_required",
      resultCount: 0,
      note: "המקור דורש כניסה כדי להשלים את החיפוש.",
    };
  }
  const normalizedTitle = normalizeSearchText(title);
  const normalizedBody = normalizeSearchText(text);
  if (!normalizedTitle) {
    return {
      status: "unavailable",
      resultCount: 0,
      note: "שם הספר חסר ולכן לא ניתן לבצע התאמה.",
    };
  }
  // Evrit parser (2026-08-16, approved). The search page only confirms a
  // matching product link exists - price and stock require a second fetch
  // of the product page itself (done in index.ts, same pattern already
  // used for Rebooks shipping). This returns an incomplete offer stub
  // (itemPrice: null) as a signal for that enrichment step to fill in;
  // if enrichment fails, index.ts drops it rather than storing a broken
  // price_offers row.
  if (sourceId === "evrit") {
    const productUrl = extractEvritProductLink(text, title);
    if (productUrl) {
      return {
        status: "found",
        resultCount: 1,
        note: "נמצא קישור מדויק לדף המוצר, ממתין לאימות מחיר ומלאי.",
        offers: [
          {
            source: "עברית",
            sourceListingKey: productUrl,
            listingTitle: title,
            sourceUrl: productUrl,
            itemPrice: null,
            availabilityStatus: null,
            condition: "חדש",
            matchType: "מדויקת",
            editionLanguage: "עברית",
            shippingKnown: false,
            shippingPrice: null,
          },
        ],
      };
    }
  }
  // Booknet / Tzomet Sfarim parser (2026-08-16, approved). Unlike Evrit,
  // the search-results page itself already has a complete, unambiguous
  // offer (price + stock) - no second fetch needed, same pattern as
  // Rebooks. Shipping is a fixed site-wide constant (see
  // booknetShipping() above), applied directly here.
  if (sourceId === "booknet") {
    const offer = extractBooknetOffer(text, title);
    if (offer) {
      const shipping = booknetShipping();
      return {
        status: "found",
        resultCount: 1,
        note: "נמצאה התאמה מדויקת עם מחיר ומלאי מאומתים.",
        offers: [
          {
            source: "צומת ספרים",
            sourceListingKey: offer.sourceUrl,
            listingTitle: title,
            sourceUrl: offer.sourceUrl,
            itemPrice: offer.itemPrice,
            availabilityStatus: offer.availabilityStatus,
            condition: "חדש",
            matchType: "מדויקת",
            editionLanguage: "עברית",
            shippingKnown: Boolean(shipping),
            shippingPrice: shipping ? shipping.price : null,
          },
        ],
      };
    }
  }
  if (sourceId === "findabook") {
    // Real fix (2026-08-17, approved): confirmed live, directly from
    // Supabase's own IP, NOT blocked (200, real HTML) unlike Rebooks/
    // Simania/Booknet/Yad2 on the same day. Item price and title match
    // are already known from the search-results card itself (same
    // pattern as Rebooks) - only per-seller shipping terms require a
    // second fetch to the product page (done in index.ts), since
    // Findabook is a private-seller marketplace with no site-wide
    // shipping policy to fall back on.
    const offer = extractFindabookOffer(text, title);
    if (offer) {
      return {
        status: "found",
        resultCount: 1,
        note: "נמצאה התאמה מדויקת, ממתין לאימות תנאי משלוח של המוכר.",
        offers: [
          {
            source: "Findabook",
            sourceListingKey: offer.sourceUrl,
            listingTitle: title,
            sourceUrl: offer.sourceUrl,
            itemPrice: offer.itemPrice,
            availabilityStatus: findabookAvailability(),
            condition: "יד שנייה",
            matchType: "מדויקת",
            editionLanguage: "עברית",
            shippingKnown: false,
            shippingPrice: null,
          },
        ],
      };
    }
  }
  // Steimatzky parser (2026-08-16, approved). Same two-step pattern as
  // Evrit: the search page only confirms a matching product link - price
  // and stock (with the print/digital ambiguity guard, see
  // extractSteimatzkyOffer above) require a second fetch of the product
  // page itself, done in index.ts.
  if (sourceId === "steimatzky") {
    const productUrl = extractSteimatzkyProductLink(text, title);
    if (productUrl) {
      return {
        status: "found",
        resultCount: 1,
        note: "נמצא קישור מדויק לדף המוצר, ממתין לאימות מחיר ומלאי.",
        offers: [
          {
            source: "סטימצקי",
            sourceListingKey: productUrl,
            listingTitle: title,
            sourceUrl: productUrl,
            itemPrice: null,
            availabilityStatus: null,
            condition: "חדש",
            matchType: "מדויקת",
            editionLanguage: "עברית",
            shippingKnown: false,
            shippingPrice: null,
          },
        ],
      };
    }
  }
  const offers = extractSourceOffers({ sourceId, title, body: text });
  if (offers.length) {
    return {
      status: "found",
      resultCount: offers.length,
      note: `נמצאו ${offers.length} הצעות זמינות עם מחיר מאומת.`,
      offers,
    };
  }
  const occurrences = normalizedBody.split(normalizedTitle).length - 1;
  if (occurrences === 0) {
    return {
      status: "not_found",
      resultCount: 0,
      note: "שם הספר לא נמצא בתוצאות שהמקור החזיר.",
    };
  }
  return {
    status: "manual_required",
    resultCount: 0,
    note:
      "שם הספר הופיע, אך לא אומתו יחד מחיר, קישור ישיר למוצר ומצב מלאי.",
  };
}

export function nextPreparationTarget(localDate, localHour, settings) {
  const morningHour = Number(settings?.morning_report_hour ?? 7);
  const eveningHour = Number(settings?.evening_check_hour ?? 21);
  if (localHour <= morningHour) {
    return { localDate, kind: "morning" };
  }
  if (localHour <= eveningHour) {
    return { localDate, kind: "evening" };
  }
  const next = new Date(`${localDate}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { localDate: next.toISOString().slice(0, 10), kind: "morning" };
}

export function isTerminalStatus(status) {
  return status !== "pending" && status !== "temporary_error";
}

// Real-shipping-cost fix (2026-08-15, approved). Rebooks/סיפור חוזר search
// result pages never include shipping cost - only the individual product
// page does, in a labeled "אפשרויות משלוח" block with three fixed options:
// self-pickup (free, but only from the branch the order was placed from),
// courier, and a nationwide "distribution point" delivery. Search-result
// scanning alone can therefore never know a real total price for this
// source, which is exactly why shipping_known was always false before this
// fix - meaning no Rebooks offer could ever pass the report's
// shipping_known filter. This parses that block from the product page's
// own HTML (fetched separately, only for an already-confirmed exact
// match - see index.ts).
const SHIPPING_LABELS = Object.freeze({
  pickup: "איסוף עצמי",
  courier: "שליח עד הבית",
  distributionPoint: "נקודת חלוקה",
});

function priceNearLabel(text, label) {
  const index = text.indexOf(label);
  if (index < 0) return null;
  const window = text.slice(index, index + 200);
  if (/חינם/.test(window)) return 0;
  const match = window.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:₪|ש["״']?ח)/);
  return match ? Number(match[1].replace(",", ".")) : null;
}

export function extractShippingOptions(html) {
  const text = textContent(html);
  const pickupPrice = priceNearLabel(text, SHIPPING_LABELS.pickup);
  const courierPrice = priceNearLabel(text, SHIPPING_LABELS.courier);
  const distributionPointPrice = priceNearLabel(
    text,
    SHIPPING_LABELS.distributionPoint,
  );
  return {
    pickup: pickupPrice === null ? null : { price: pickupPrice },
    courier: courierPrice === null ? null : { price: courierPrice },
    distributionPoint:
      distributionPointPrice === null
        ? null
        : { price: distributionPointPrice },
  };
}

// Picks the single shipping figure to use as the report's shipping_price:
// distribution point is preferred because it is available nationwide
// regardless of the user's location or which branch has the book, unlike
// self-pickup (tied to a specific branch). Courier is used only if no
// distribution-point price was found. See bestKnownShipping() below for
// the final version that also considers self-pickup once a carrying
// branch is known to be approved.

// Self-pickup branch matching (2026-08-15, approved). Self-pickup at
// Rebooks is free but only from the specific branch the book is ordered
// from - it only counts as a valid "cheapest option" if that branch is
// somewhere convenient for the user. This list was confirmed explicitly
// with the user against the full, real branch list fetched from
// rebooks.org.il/סניפים/ on 2026-08-15 (24 branches total). Netanya:
// included per explicit confirmation. Yavne: excluded per explicit
// confirmation. Modi'in and Bnei Brak have no Rebooks branch at all, so
// they never appear here regardless of being in the general approved-area
// list for shipping.
const APPROVED_PICKUP_CITIES = Object.freeze([
  "פתח תקווה",
  "תל אביב",
  "רמת גן",
  "גבעתיים",
  "ראשון לציון",
  "חולון",
  "רחובות",
  "רמלה",
  "כפר סבא",
  "ירושלים",
  "נתניה",
]);

export function isApprovedPickupBranch(branchName) {
  const normalized = normalizeSearchText(branchName);
  if (!normalized) return false;
  return APPROVED_PICKUP_CITIES.some((city) =>
    normalized.includes(normalizeSearchText(city)),
  );
}

// Parses which physical branches currently carry a specific book, from the
// product page's "זמינות המוצר בסניפים" section (a different section from
// the shipping-options block above).
const AVAILABLE_BRANCHES_SECTION_LABEL = "זמינות המוצר בסניפים";

export function extractAvailableBranches(html) {
  const text = textContent(html);
  const sectionIndex = text.indexOf(AVAILABLE_BRANCHES_SECTION_LABEL);
  if (sectionIndex < 0) return [];
  const window = text.slice(sectionIndex, sectionIndex + 4000);
  const matches = [...window.matchAll(/סניף\s+([^\n\r(),.]{2,30})/g)];
  const names = matches.map((match) => match[1].trim()).filter(Boolean);
  return [...new Set(names)];
}

// Final shipping decision: compares every option that is actually valid
// for this user (self-pickup only if a carrying branch is approved,
// distribution point and courier always since both are nationwide) and
// returns the genuinely cheapest one - implementing the user's ranking
// rule directly (2026-08-15): "the cheapest, best, most convenient total
// price for the consumer, not source-checking order."
export function bestKnownShipping(options, availableBranches = []) {
  const candidates = [];
  if (
    options?.pickup &&
    availableBranches.some((branch) => isApprovedPickupBranch(branch))
  ) {
    candidates.push({ price: options.pickup.price, method: "pickup" });
  }
  if (options?.distributionPoint) {
    candidates.push({
      price: options.distributionPoint.price,
      method: "distributionPoint",
    });
  }
  if (options?.courier) {
    candidates.push({ price: options.courier.price, method: "courier" });
  }
  if (!candidates.length) return null;
  return candidates.reduce((best, candidate) =>
    candidate.price < best.price ? candidate : best,
  );
}

// Evrit (e-vrit.co.il) parser (2026-08-16, approved). Unlike Rebooks,
// shipping here is a fixed, site-wide published policy (help.e-vrit.co.il,
// confirmed live 2026-08-16), not something shown per-product:
//   - שליח עד הבית (courier): 29 ₪
//   - נקודת חלוקה (distribution point): 15 ₪
//   - איסוף עצמי (self-pickup): free, from a single fixed warehouse
//     ("בית ידיעות אחרונות, רחוב מוזס 1 ראשון לציון") - unlike Rebooks'
//     many branches, this is the same one location for every order, and
//     Rishon LeZion is already in the approved pickup list. So pickup is
//     treated as always available whenever the book itself is in stock -
//     no per-book branch lookup needed, unlike Rebooks.
// These are constants, not parsed from any page, and reuse the exact same
// bestKnownShipping()/isApprovedPickupBranch() already built for Rebooks.
const EVRIT_SHIPPING_OPTIONS = Object.freeze({
  pickup: { price: 0 },
  distributionPoint: { price: 15 },
  courier: { price: 29 },
});
const EVRIT_PICKUP_LOCATION = Object.freeze(["ראשון לציון"]);

export function evritShipping() {
  return bestKnownShipping(EVRIT_SHIPPING_OPTIONS, EVRIT_PICKUP_LOCATION);
}

// Finds the product page URL for an exact title match on an Evrit search
// results page. Evrit product URLs follow /product/{id}/{slug} (case seen
// both ways in the wild). This does not assume specific CSS classes -
// only that a matching product is linked with the title as visible link
// text, which is the one structural fact confirmed from real search
// engine indexing of these exact URLs.
const EVRIT_PRODUCT_LINK_PATTERN =
  /<a\b[^>]*href=["']([^"']*\/[Pp]roduct\/\d+\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/g;

export function extractEvritProductLink(html, title) {
  const wantedTitle = normalizeSearchText(title);
  if (!wantedTitle) return null;
  const matches = [...String(html || "").matchAll(EVRIT_PRODUCT_LINK_PATTERN)];
  for (const match of matches) {
    const linkText = textContent(match[2]);
    if (normalizeSearchText(linkText) === wantedTitle) {
      return decodeHtml(match[1]);
    }
  }
  return null;
}

// Parses a single Evrit product page for the printed-book price and
// whether it is currently purchasable. "מודפס" only appears with a price
// when a print edition is sold at all (Evrit also sells digital/audio
// editions on the same page, which must not be mistaken for a print
// price). Confirmed live on a real product page (2026-08-16): "מודפס"
// immediately followed by "₪76.8" text, with no explicit out-of-stock
// marker anywhere nearby on that particular (in-stock) example - the
// "אזל" check below follows the same convention already used for Rebooks
// and is Evrit's most likely out-of-stock wording, but has not been
// confirmed against a live out-of-stock Evrit page.
function evritPrintPriceNear(text) {
  const index = text.indexOf("מודפס");
  if (index < 0) return null;
  const window = text.slice(index, index + 60);
  // Real format confirmed live (2026-08-16): the ₪ symbol comes BEFORE
  // the number ("₪76.8"), the reverse of the Rebooks/general convention
  // used elsewhere in this file.
  const match = window.match(/₪\s*(\d{1,4}(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : null;
}

export function extractEvritProductDetails(html) {
  const text = textContent(html);
  const itemPrice = evritPrintPriceNear(text);
  if (itemPrice === null) return null;
  const printIndex = text.indexOf("מודפס");
  const nearbyWindow = text.slice(
    Math.max(0, printIndex - 40),
    printIndex + 150,
  );
  const outOfStock = /אזל/.test(nearbyWindow);
  return {
    itemPrice,
    availabilityStatus: outOfStock ? "לא במלאי" : "במלאי",
  };
}

// Booknet / Tzomet Sfarim parser (2026-08-16, approved). Confirmed live
// (2026-08-16): booknet.co.il IS Tzomet Sfarim ("צומת ספרים") - the same
// site, not a separate one. Unlike Evrit and Steimatzky, product cards
// here are print-only with no digital-edition ambiguity anywhere - the
// exact price is available directly on the search-results page itself,
// same single-fetch pattern as Rebooks (no second product-page fetch
// needed). Shipping is a fixed, site-wide published policy
// (booknet.co.il/מדיניות-משלוחים, confirmed live 2026-08-16): נקודת
// איסוף (distribution point) 17 ₪, שליח עד הבית (courier) 25 ₪, and free
// self-pickup from a single fixed location ("משרדי צומת ספרים, רחוב
// התקווה 6 רמלה") - Ramla is already in the approved pickup list, and
// like Evrit this is the same location for every order.
const BOOKNET_SHIPPING_OPTIONS = Object.freeze({
  pickup: { price: 0 },
  distributionPoint: { price: 17 },
  courier: { price: 25 },
});
const BOOKNET_PICKUP_LOCATION = Object.freeze(["רמלה"]);

export function booknetShipping() {
  return bestKnownShipping(BOOKNET_SHIPPING_OPTIONS, BOOKNET_PICKUP_LOCATION);
}

// Confirmed live (2026-08-16) card structure repeats site-wide for every
// book, both on the main product page's "מוצרים נוספים" related-items
// strip and (by the same template) on search-result grids: title as an
// anchor's visible text under a /מוצרים/ path, followed within the same
// card by "מחיר נוכחי: NUM שח" and an "הוסף לסל" add-to-cart control when
// purchasable.
const BOOKNET_LINK_PATTERN =
  /<a\b[^>]*href=["']([^"']*(?:מוצרים|%D7%9E%D7%95%D7%A6%D7%A8%D7%99%D7%9D)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

export function extractBooknetOffer(html, title) {
  const wantedTitle = normalizeSearchText(title);
  if (!wantedTitle) return null;
  const raw = String(html || "");
  const matches = [...raw.matchAll(BOOKNET_LINK_PATTERN)];
  for (const match of matches) {
    const linkText = textContent(match[2]);
    // Real link text (2026-08-16) can repeat the title exactly (e.g. an
    // <img alt="title"> plus separate visible text both flatten to
    // "title title") - handled precisely rather than with a loose
    // substring check, which would risk false-matching a short title
    // inside an unrelated longer one.
    const normalizedLinkText = normalizeSearchText(linkText);
    const isExactMatch = normalizedLinkText === wantedTitle;
    const isDuplicatedMatch =
      normalizedLinkText === `${wantedTitle} ${wantedTitle}`;
    if (!isExactMatch && !isDuplicatedMatch) continue;
    const sourceUrl = decodeHtml(match[1]);
    const start = match.index || 0;
    const windowText = textContent(raw.slice(start, start + 1500));
    const priceMatch = windowText.match(
      /מחיר נוכחי:\s*(\d{1,4}(?:\.\d{1,2})?)\s*שח/,
    );
    if (!priceMatch) continue;
    const itemPrice = Number(priceMatch[1]);
    if (!Number.isFinite(itemPrice) || itemPrice <= 0) continue;
    const purchasable = /הוסף לסל/.test(windowText);
    const outOfStock = /אזל|לא במלאי/.test(windowText) || !purchasable;
    return {
      sourceUrl,
      itemPrice,
      availabilityStatus: outOfStock ? "לא במלאי" : "במלאי",
    };
  }
  return null;
}

// Steimatzky parser (2026-08-16, approved). Deliberately conservative:
// a real fetched product page (2026-08-16) showed TWO different prices
// for the same URL - a server-rendered meta tag (69 ₪) and a separately
// labeled "ספר דיגיטלי ... מחיר מוצר 35.00 ₪" block in the visible page
// content - for a title explicitly described as available in either
// print or digital format. Which one the meta tag represents could not
// be confirmed with certainty ahead of time. Per the user's explicit
// instruction to only ever show print books, and this project's core
// rule to never show an invented or uncertain price: if the page shows
// a distinctly-labeled digital price that DIFFERS from the meta price,
// this returns null (no offer) rather than guessing. Only when there is
// no such conflicting digital block (single-format print-only pages,
// which are common) is the meta price trusted.
function steimatzkyMetaPrice(html) {
  const match =
    html.match(/property=["'](?:og:)?product:price:amount["'][^>]*content=["']([\d.]+)["']/i) ||
    html.match(/content=["']([\d.]+)["'][^>]*property=["'](?:og:)?product:price:amount["']/i);
  if (!match) return null;
  const price = Number(match[1]);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function extractSteimatzkyOffer(html) {
  const price = steimatzkyMetaPrice(html);
  if (price === null) return null;
  const text = textContent(html);
  const digitalMatch = text.match(
    /ספר דיגיטלי[^₪]{0,60}מחיר מוצר\s*(\d+(?:\.\d+)?)\s*₪/,
  );
  if (digitalMatch && Number(digitalMatch[1]) !== price) {
    // Ambiguous: cannot be sure the meta price is for the print edition.
    return null;
  }
  const outOfStock = /אזל|חסר זמנית/.test(text);
  return {
    itemPrice: price,
    availabilityStatus: outOfStock ? "לא במלאי" : "במלאי",
  };
}

// Steimatzky product links seen live (2026-08-16) are bare 9-digit paths
// (e.g. /012010227), not a /product/ prefix like Evrit - matched here
// without assuming any particular CSS class, only that the title is the
// link's visible text (the same structural assumption already used for
// Evrit, still unverified against live search-results markup).
const STEIMATZKY_LINK_PATTERN =
  /<a\b[^>]*href=["']([^"']*\/\d{9}[^"']*)["'][^>]*>([\s\S]*?)<\/a>/g;

export function extractSteimatzkyProductLink(html, title) {
  const wantedTitle = normalizeSearchText(title);
  if (!wantedTitle) return null;
  const matches = [
    ...String(html || "").matchAll(STEIMATZKY_LINK_PATTERN),
  ];
  for (const match of matches) {
    const linkText = textContent(match[2]);
    if (normalizeSearchText(linkText) === wantedTitle) {
      return decodeHtml(match[1]);
    }
  }
  return null;
}

export function steimatzkyShipping() {
  // Confirmed live (2026-08-16, steimatzky.co.il/customer-service/shipping):
  // no self-pickup option published for Steimatzky (unlike Evrit/Booknet).
  // "דואר רשום" (registered mail, 10 ₪) is the cheapest published option,
  // cheaper than "שליח עד הבית" (courier, 25 ₪).
  return { price: 10, method: "registeredMail" };
}

// Findabook parser (2026-08-17, approved). Unlike Rebooks/Evrit/Booknet
// (single retailer, one shipping policy), Findabook is a private-seller
// peer marketplace (like Yad2/Simania) - confirmed live, 2026-08-17:
// every seller writes their own shipping terms in free text on their own
// product page, e.g. "עלות שליחת הספר בדואר 15.9 (דואר רשום)" or a
// title/description tag "(המחיר כולל משלוח)" meaning price already
// includes shipping. There is no site-wide constant to fall back on like
// the other new sources. Confirmed NOT blocked (200, real HTML) directly
// from Supabase's own IP, unlike Rebooks/Simania/Booknet/Yad2 today.
//
// Search-results card structure confirmed live: <a class="hover-text"
// href="...">...</a> ... <h3>TITLE/AUTHOR</h3> ... <li
// class="strong">PRICE ₪</li>. Title and author are concatenated with a
// "/" in the h3 text (not a separate field), so matching checks that the
// wanted title is the card's title followed by a word boundary, not an
// exact string equality.
const FINDABOOK_CARD_PATTERN =
  /<a\s+class="hover-text"\s+href="([^"]+)"[^>]*>[\s\S]*?<h3>([^<]*)<\/h3>[\s\S]*?<li class="strong">\s*([\d.,]+)\s*₪/g;

export function extractFindabookOffer(html, title) {
  const wantedTitle = normalizeSearchText(title);
  if (!wantedTitle) return null;
  const text = String(html || "");
  for (const match of text.matchAll(FINDABOOK_CARD_PATTERN)) {
    const [, url, h3Text, priceText] = match;
    // Real fix (2026-08-17): a naive "starts with the wanted title" check
    // false-matched a short/generic title (e.g. "ספר") against a
    // completely different, longer one that merely happened to start
    // with the same word. Since title and author are always joined with
    // "/" in this exact card format, splitting on it and requiring an
    // EXACT match on the title portion alone is precise and avoids that
    // risk entirely.
    const titlePart = String(h3Text).split("/")[0];
    if (normalizeSearchText(titlePart) !== wantedTitle) continue;
    const itemPrice = Number(String(priceText).replace(",", "."));
    if (!Number.isFinite(itemPrice) || itemPrice <= 0) continue;
    return { sourceUrl: decodeHtml(url), itemPrice };
  }
  return null;
}

// Findabook listings never disappear into an "out of stock" state the
// way a retailer's catalog does - a peer marketplace listing is removed
// once sold, so if it still appears in search results with a price, it
// is treated as available. This is an inference from how peer
// marketplaces generally work, not a directly confirmed site rule -
// noted explicitly since it differs from every other source in this
// file, which all read an explicit stock marker.
export function findabookAvailability() {
  return "במלאי";
}

// Per-seller shipping terms (2026-08-17, approved) - deliberately
// conservative. Only two patterns are trusted, both confirmed against
// real listings live: an explicit "(המחיר כולל משלוח)" tag (shipping
// already included in the item price, so 0 additional) or an explicit
// seller-stated cost near "עלות שליחת הספר"/"עלות משלוח". Any listing
// that states its shipping terms differently returns null (unknown) -
// per the project's core rule, an unclear shipping cost must never be
// guessed or defaulted to a number.
export function extractFindabookShipping(html) {
  const text = textContent(html);
  if (/המחיר כולל משלוח/.test(text)) {
    return { price: 0, method: "includedInPrice" };
  }
  const match = text.match(
    /עלות (?:שליחת הספר|משלוח)[^\d]{0,20}(\d{1,3}(?:\.\d{1,2})?)/,
  );
  if (match) {
    const price = Number(match[1]);
    if (Number.isFinite(price) && price >= 0 && price < 200) {
      return { price, method: "sellerStated" };
    }
  }
  return null;
}
