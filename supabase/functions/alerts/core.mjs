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
  const eveningHour = Number(settings.evening_check_hour ?? 19);
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

export function dealTotal(offer, threshold) {
  const total = offer.total_price === null ? null : Number(offer.total_price);
  if (
    offer.edition_language !== "עברית" ||
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
  return Boolean(configuredSecret) && providedSecret === configuredSecret;
}

export function assertEmailAccepted(response) {
  if (!response.ok) throw new Error(`Email failed with ${response.status}`);
}
