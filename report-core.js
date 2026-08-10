(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HamadafReport = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const TERMINAL_STATUSES = new Set([
    "found",
    "not_found",
    "login_required",
    "blocked",
    "temporary_error",
    "unavailable",
    "manual_required",
  ]);

  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function totalPrice(offer) {
    const item = numberOrNull(offer.item_price);
    if (item === null || !offer.shipping_known) return null;
    return item + (numberOrNull(offer.shipping_price) || 0);
  }

  function eligibleOffer(offer) {
    return (
      offer.active !== false &&
      offer.is_removed !== true &&
      offer.edition_language !== "אנגלית" &&
      offer.match_type !== "לא התאמה"
    );
  }

  function rankBookOffers(offers, limit = 3) {
    const active = offers.filter(eligibleOffer);
    const exact = active.filter((offer) => offer.match_type !== "דומה");
    const known = exact
      .filter((offer) => totalPrice(offer) !== null)
      .sort((a, b) => totalPrice(a) - totalPrice(b));
    return {
      ranked: known.slice(0, limit),
      unknownShipping: exact.filter((offer) => totalPrice(offer) === null),
      alternatives: active.filter((offer) => offer.match_type === "דומה"),
    };
  }

  function coverageSummary(checks, expectedChecks = checks.length) {
    const completed = checks.filter((check) =>
      TERMINAL_STATUSES.has(check.status),
    ).length;
    const expected = Math.max(Number(expectedChecks) || 0, checks.length);
    const statusCounts = checks.reduce((counts, check) => {
      counts[check.status] = (counts[check.status] || 0) + 1;
      return counts;
    }, {});
    return {
      completed,
      expected,
      pending: Math.max(0, expected - completed),
      percent: expected ? Math.round((completed / expected) * 10000) / 100 : 0,
      statusCounts,
      complete: expected > 0 && completed === expected,
    };
  }

  function groupOffersByBook(offers) {
    return offers.reduce((groups, offer) => {
      if (!groups[offer.book_id]) groups[offer.book_id] = [];
      groups[offer.book_id].push(offer);
      return groups;
    }, {});
  }

  function bestDeals(books, offers, target = 30) {
    const grouped = groupOffersByBook(offers);
    return books
      .map((book) => {
        const ranking = rankBookOffers(grouped[book.id] || []);
        return { book, ...ranking };
      })
      .filter((item) => item.ranked.length)
      .sort(
        (a, b) =>
          totalPrice(a.ranked[0]) - totalPrice(b.ranked[0]) ||
          String(a.book.title).localeCompare(String(b.book.title), "he"),
      )
      .map((item) => ({
        ...item,
        withinTarget: totalPrice(item.ranked[0]) <= target,
      }));
  }

  return {
    TERMINAL_STATUSES,
    bestDeals,
    coverageSummary,
    groupOffersByBook,
    rankBookOffers,
    totalPrice,
  };
});
