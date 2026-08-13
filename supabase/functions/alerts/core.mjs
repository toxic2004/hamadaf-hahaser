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
  const total = offer.total_price === null ? null : Number(offer.total_price);
  if (
    offer.edition_language !== "עברית" ||
    offer.availability_status !== "במלאי" ||
    offer.match_type === "לא התאמה" ||
    !offer.active ||
    offer.is_removed ||
    total === null ||
    !Number.isFinite(total) ||
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
