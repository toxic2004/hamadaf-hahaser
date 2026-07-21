(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HamadafPrice = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function httpUrl(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    try {
      const url = new URL(text);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function totalPrice(offer) {
    const item = numberOrNull(offer.item_price ?? offer.itemPrice);
    const shippingKnown = Boolean(offer.shipping_known ?? offer.shippingKnown);
    const shipping = numberOrNull(offer.shipping_price ?? offer.shippingPrice);
    if (item === null || !shippingKnown) return null;
    return item + (shipping ?? 0);
  }

  function calculateDeal(offer, now = new Date()) {
    const total = totalPrice(offer);
    const reference = numberOrNull(
      offer.reference_new_price ?? offer.referenceNewPrice,
    );
    const matchType = offer.match_type ?? offer.matchType ?? "מדויקת";
    const language = offer.edition_language ?? offer.editionLanguage ?? "עברית";
    const active = offer.active !== false && offer.is_removed !== true;
    if (language !== "עברית" || matchType === "לא התאמה" || !active) {
      return {
        score: 0,
        total,
        worthwhile: false,
        reasons: ["ההצעה אינה התאמה עברית פעילה"],
      };
    }
    const reasons = [];
    let score = 0;
    if (total !== null && reference !== null && reference > 0) {
      const savingPercent = ((reference - total) / reference) * 100;
      const savingPoints = Math.max(0, Math.min(60, savingPercent));
      score += savingPoints;
      reasons.push(
        `חיסכון של ${savingPercent.toFixed(1)}%: ${savingPoints.toFixed(1)} מתוך 60`,
      );
    } else {
      reasons.push("אין מחיר כולל ומחיר חדש יחד: 0 מתוך 60");
    }
    if (total !== null) {
      score += 10;
      reasons.push("מחיר כולל ידוע: 10 מתוך 10");
    } else reasons.push("מחיר או משלוח חסרים: 0 מתוך 10");
    const matchPoints =
      matchType === "מדויקת" ? 15 : matchType === "דומה" ? 7 : 0;
    score += matchPoints;
    reasons.push(`איכות התאמה: ${matchPoints} מתוך 15`);
    score += 10;
    reasons.push("מהדורה בעברית: 10 מתוך 10");
    const checked = offer.last_checked_at
      ? new Date(offer.last_checked_at)
      : null;
    const fresh =
      checked &&
      Number.isFinite(checked.getTime()) &&
      now - checked <= 2 * 86400000;
    if (fresh) {
      score += 5;
      reasons.push("נבדקה ביומיים האחרונים: 5 מתוך 5");
    } else reasons.push("לא נבדקה ביומיים האחרונים: 0 מתוך 5");
    score = Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
    return { score, total, worthwhile: score >= 70, reasons };
  }

  function compareOffers(first, second) {
    const a = totalPrice(first);
    const b = totalPrice(second);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  }

  function splitRankedOffers(offers) {
    const active = offers.filter(
      (offer) =>
        offer.active !== false &&
        offer.is_removed !== true &&
        offer.edition_language !== "אנגלית",
    );
    const group = (condition) => {
      const matching = active
        .filter((offer) => offer.condition === condition)
        .sort(compareOffers);
      return {
        cheapest: matching
          .filter((offer) => totalPrice(offer) !== null)
          .slice(0, 3),
        withoutPrice: matching.filter((offer) => totalPrice(offer) === null),
      };
    };
    return { newOffers: group("חדש"), usedOffers: group("יד שנייה") };
  }

  function fingerprint(offer) {
    const raw = [
      offer.source,
      offer.source_url || offer.sourceUrl,
      offer.listing_title || offer.listingTitle,
      offer.seller_name || offer.sellerName,
      offer.book_id || offer.bookId,
    ]
      .map((value) =>
        String(value || "")
          .trim()
          .toLowerCase(),
      )
      .join("|");
    let hash = 2166136261;
    for (let index = 0; index < raw.length; index += 1) {
      hash ^= raw.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `manual-${(hash >>> 0).toString(16)}`;
  }

  return {
    calculateDeal,
    compareOffers,
    fingerprint,
    httpUrl,
    numberOrNull,
    splitRankedOffers,
    totalPrice,
  };
});
