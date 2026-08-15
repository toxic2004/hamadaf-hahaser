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
