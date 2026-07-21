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

export function assertEmailAccepted(response) {
  if (!response.ok) throw new Error(`Email failed with ${response.status}`);
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
