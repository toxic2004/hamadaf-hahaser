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
    if (/\boutofstock\b/i.test(marker[0]) || /אזל\s+מהמלאי/i.test(card))
      continue;
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
    const listingKey = marker[1] || sourceUrl;
    offers.set(listingKey, {
      source: "סיפור חוזר",
      sourceListingKey: listingKey,
      listingTitle,
      sourceUrl,
      itemPrice,
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
  if (occurrences === 1) {
    return {
      status: "manual_required",
      resultCount: 0,
      note: "שם הספר הופיע רק בכותרת החיפוש. לא נמצאה הוכחה מספקת לרשומת מוצר.",
    };
  }
  const prices = pricesNearTitle(text, title);
  return {
    status: "found",
    resultCount: 1,
    note: prices.length
      ? `נמצאה התאמה לשם הספר. מחירים שזוהו בעמוד: ${prices.join(", ")} ₪.`
      : "נמצאה התאמה לשם הספר. המחיר לא זוהה באופן אמין.",
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
