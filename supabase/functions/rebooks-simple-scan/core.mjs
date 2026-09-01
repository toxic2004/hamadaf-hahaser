// Deliberate duplicate of supabase/functions/alerts/core.mjs
// (2026-08-31 redeploy): discovered this function's LIVE deployment
// had been silently stuck on an Aug-19 snapshot of this file for
// weeks - merging to git never triggers a redeploy, and a
// ../alerts/ relative import isn't reliable for this deploy path
// (each Edge Function deploys as a self-contained unit). Copied
// here explicitly so the git-tracked source matches what's
// actually live, instead of silently drifting again. If this file
// ever changes, update alerts/core.mjs too AND redeploy
// rebooks-simple-scan - a git merge alone changes nothing live.

export function jerusalemParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
}

export function scheduledKinds(settings, localHour) {
  const morningHour = Number(settings.morning_report_hour ?? 7);
  const eveningHour = Number(settings.evening_check_hour ?? 21);
  const kinds = [];
  if (localHour === morningHour) kinds.push("בוקר");
  if (localHour === eveningHour) kinds.push("ערב");
  return kinds;
}

export function priceDrop(previousValue, currentValue) {
  const current = Number(currentValue);
  const previous = Number(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (!(current < previous)) return null;
  return { previous, current };
}

export const MAX_REPORT_TOTAL = 30;

export function isDirectProductUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const path = decodeURIComponent(url.pathname).toLocaleLowerCase("en-US");
    const searchPath =
      path === "/search" ||
      path.startsWith("/search/") ||
      path.includes("catalogsearch") ||
      path.includes("searchbooks.php") ||
      path.includes("חיפוש");
    if (searchPath) return false;
    if (url.hostname.includes("google.") && path.startsWith("/search"))
      return false;
    const searchKeys = ["s", "search", "query", "q", "keyword"];
    const hasSearchQuery = searchKeys.some((key) => url.searchParams.has(key));
    const directPath =
      /\/(?:product|products|item|items|listing|listings|book|books)\//.test(
        path,
      ) || path.includes("bookdetails");
    return !hasSearchQuery || directPath;
  } catch {
    return false;
  }
}

export function reportableOfferTotal(offer) {
  // Two-tier pricing fix (2026-08-16, approved). Previously this rejected
  // anything over MAX_REPORT_TOTAL outright, which meant new-book sources
  // (Evrit, Steimatzky, Booknet/Tzomet Sfarim - all sell new copies, never
  // near 30 ₪) could NEVER appear in a report no matter how well scanning
  // worked. The user's actual rule has two tiers, not one cutoff: see
  // dealTier() below, which is what now does the classification.
  if (offer?.shipping_known !== true || offer?.total_price === null)
    return null;
  const total = Number(offer?.total_price);
  if (!Number.isFinite(total) || total < 0) return null;
  return total;
}

// "used" = recommend (matches the previous single-cap behavior exactly for
// anything <= MAX_REPORT_TOTAL). "new" = informational only, per the
// user's explicit instruction (2026-08-16) that an above-target offer can
// only appear clearly marked as information, never as a recommendation,
// with no upper cap.
export function dealTier(total) {
  return total <= MAX_REPORT_TOTAL ? "used" : "new";
}

export function isCompleteReportOffer(offer) {
  const itemPrice = Number(offer?.item_price);
  return (
    Boolean(offer?.book_id) &&
    Boolean(String(offer?.source || "").trim()) &&
    Number.isFinite(itemPrice) &&
    itemPrice > 0 &&
    reportableOfferTotal(offer) !== null &&
    ["במלאי", "לא במלאי"].includes(offer?.availability_status) &&
    isDirectProductUrl(offer?.source_url)
  );
}

export function reportQualityGate(run, offers) {
  return (
    run?.status === "completed" &&
    Number(run?.expected_books) > 0 &&
    Number(run?.expected_checks) > 0 &&
    Number(run?.completed_checks) === Number(run?.expected_checks) &&
    Array.isArray(offers) &&
    offers.length > 0 &&
    offers.every(isCompleteReportOffer)
  );
}

export function reportOfferChanges(offers, deliveredReports = []) {
  const previousBestByBook = new Map();
  for (const report of deliveredReports || []) {
    const reportedOffers = Array.isArray(report?.metadata?.reported_offers)
      ? report.metadata.reported_offers
      : [];
    for (const offer of reportedOffers) {
      const price = Number(offer?.total_price ?? offer?.item_price);
      if (!offer?.book_id || !Number.isFinite(price)) continue;
      const previous = previousBestByBook.get(offer.book_id);
      if (previous === undefined || price < previous) {
        previousBestByBook.set(offer.book_id, price);
      }
    }
  }

  const currentBestByBook = new Map();
  for (const offer of offers || []) {
    const price = Number(offer?.total_price ?? offer?.item_price);
    if (!offer?.book_id || !Number.isFinite(price)) continue;
    const current = currentBestByBook.get(offer.book_id);
    if (!current || price < Number(current.total_price ?? current.item_price)) {
      currentBestByBook.set(offer.book_id, offer);
    }
  }

  return [...currentBestByBook.values()]
    .map((offer) => {
      const currentPrice = Number(offer.total_price ?? offer.item_price);
      const previousPrice = previousBestByBook.get(offer.book_id);
      if (previousPrice !== undefined && currentPrice >= previousPrice) {
        return null;
      }
      return {
        ...offer,
        previous_price: previousPrice ?? null,
        savings:
          previousPrice === undefined ? null : previousPrice - currentPrice,
        change_type: previousPrice === undefined ? "new" : "lower",
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.change_type !== right.change_type) {
        return left.change_type === "lower" ? -1 : 1;
      }
      return (
        Number(left.total_price ?? left.item_price) -
        Number(right.total_price ?? right.item_price)
      );
    });
}

export function dealTotal(offer, threshold) {
  const total = reportableOfferTotal(offer);
  // "Deal" instant-alert notifications are specifically about used-book
  // bargains under the target price - unlike the daily report (which now
  // also shows new-book listings as information, see dealTier() above),
  // an instant "great deal" alert should stay capped at MAX_REPORT_TOTAL.
  // A 90 ₪ new book is not what this alert type means.
  if (
    offer.edition_language !== "עברית" ||
    offer.availability_status !== "במלאי" ||
    offer.match_type === "לא התאמה" ||
    !offer.active ||
    offer.is_removed ||
    total === null ||
    total > MAX_REPORT_TOTAL ||
    Number(offer.deal_score || 0) < threshold
  )
    return null;
  return total;
}

export function dealDedupeKey(offerId, total) {
  return `${offerId}:deal:${total}`;
}

export function priceDropDedupeKey(offerId, current) {
  return `${offerId}:drop:${current}`;
}

export function isScheduleAuthorized(configuredSecret, providedSecret) {
  if (!configuredSecret || !providedSecret) return false;
  const expected = new TextEncoder().encode(configuredSecret);
  const received = new TextEncoder().encode(providedSecret);
  const length = Math.max(expected.length, received.length);
  let difference = expected.length ^ received.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (expected[index] || 0) ^ (received[index] || 0);
  }
  return difference === 0;
}

export function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function requestMode(value) {
  return value === "offer" || value === "schedule" ? value : null;
}

// Gmail-delivery fix (2026-08-15, pending approval): the exact required
// subject format is "המדף החסר: דוח בוקר DD.MM.YYYY" / "...: דוח ערב
// DD.MM.YYYY". A previous fix (2026-08-14) used a different title
// ("דוח בוקר של המדף החסר") which did not match this - the same mismatch
// already found in real sent emails during the 2026-08-14 audit. This is
// the single place that formats the subject, used both for the report
// notification's title and (once SMTP delivery is wired in) the actual
// email Subject header, so the two can never drift apart again.
export function reportSubject(reportKind, localDate) {
  const [year, month, day] = String(localDate).split("-");
  const label = reportKind === "morning" ? "דוח בוקר" : "דוח ערב";
  if (!year || !month || !day) return `המדף החסר: ${label}`;
  return `המדף החסר: ${label} ${day}.${month}.${year}`;
}
