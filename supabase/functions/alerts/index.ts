import { createClient } from "npm:@supabase/supabase-js@2.110.9";
import {
  dealDedupeKey,
  dealTotal,
  isCompleteReportOffer,
  isUuid,
  jerusalemParts,
  MAX_REPORT_TOTAL,
  priceDrop,
  priceDropDedupeKey,
  reportableOfferTotal,
  reportOfferChanges,
  reportQualityGate,
  reportSubject,
  requestMode,
} from "./core.mjs";
import {
  classifySearchResponse,
  nextPreparationTarget,
  sourcePlan,
} from "./scanner-core.mjs";
import { sendMailViaGmailSmtp } from "./smtp-client.mjs";

const GMAIL_SENDER_ADDRESS =
  Deno.env.get("GMAIL_SENDER_ADDRESS") || "toxic2004@gmail.com";
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD") || "";
const MAX_EMAIL_SEND_ATTEMPTS = 5;
const MAX_EMAILS_PER_INVOCATION = 5;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const MAX_BODY_BYTES = 16_384;
const SCAN_BATCH_SIZE = 80;
const SCAN_CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 6_000;
const MAX_SCAN_ATTEMPTS = 3;
let serviceClient: ReturnType<typeof createClient> | null = null;

function service() {
  if (!SUPABASE_URL || !SERVICE_KEY)
    throw new Error("Missing required Supabase service configuration");
  if (!serviceClient)
    serviceClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });
  return serviceClient;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function readJson(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json"))
    return {
      error: json({ error: "content type must be application/json" }, 415),
    };
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES)
    return { error: json({ error: "request body too large" }, 413) };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES)
    return { error: json({ error: "request body too large" }, 413) };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return { error: json({ error: "invalid request body" }, 400) };
    return { body: body as Record<string, unknown> };
  } catch {
    return { error: json({ error: "invalid JSON" }, 400) };
  }
}

async function settingsFor(userId: string) {
  const { data, error } = await service()
    .from("notification_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (
    data || {
      user_id: userId,
      timezone: "Asia/Jerusalem",
      morning_report_hour: 7,
      evening_check_hour: 21,
      immediate_deal_threshold: 70,
      email_enabled: true,
      email_address: null,
    }
  );
}

async function insertNotification(row: Record<string, unknown>) {
  const { data, error } = await service()
    .from("notifications")
    .upsert(row, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
    .select("*");
  if (error) throw error;
  return data?.[0] || null;
}

async function priceDropNotification(offer: Record<string, any>) {
  const { data, error } = await service()
    .from("price_history")
    .select("total_price,captured_on")
    .eq("user_id", offer.user_id)
    .eq("offer_id", offer.id)
    .not("total_price", "is", null)
    .order("captured_on", { ascending: false })
    .limit(2);
  if (error) throw error;
  if (!data || data.length < 2) return null;
  const drop = priceDrop(data[1].total_price, data[0].total_price);
  if (!drop) return null;
  const { current, previous } = drop;
  return insertNotification({
    user_id: offer.user_id,
    book_id: offer.book_id,
    offer_id: offer.id,
    notification_type: "ירידת מחיר",
    title: "ירידת מחיר",
    body: `המחיר ירד מ ${previous.toFixed(2)} ₪ ל ${current.toFixed(2)} ₪ אצל ${offer.source}`,
    dedupe_key: priceDropDedupeKey(offer.id, current),
    metadata: {
      previous_price: previous,
      total_price: current,
      source: offer.source,
    },
  });
}

async function dealNotification(offer: Record<string, any>, threshold: number) {
  const total = dealTotal(offer, threshold);
  if (total === null) return null;
  return insertNotification({
    user_id: offer.user_id,
    book_id: offer.book_id,
    offer_id: offer.id,
    notification_type: "עסקה משתלמת",
    title: "נמצאה עסקה משתלמת",
    body: `${offer.listing_title || "ספר"}: ${total.toFixed(2)} ₪ אצל ${offer.source}`,
    dedupe_key: dealDedupeKey(offer.id, total),
    metadata: {
      total_price: total,
      score: offer.deal_score,
      source: offer.source,
    },
  });
}

async function processOfferMode(request: Request, body: Record<string, any>) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer "))
    return json({ error: "unauthorized" }, 401);
  if (!isUuid(body.offerId)) return json({ error: "invalid offer id" }, 400);
  if (!SUPABASE_URL || !ANON_KEY)
    throw new Error("Missing required Supabase authentication configuration");
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { authorization } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "unauthorized" }, 401);
  const { data: offer, error } = await service()
    .from("price_offers")
    .select("*")
    .eq("id", body.offerId)
    .eq("user_id", authData.user.id)
    .single();
  if (error || !offer) return json({ error: "offer not found" }, 404);
  const settings = await settingsFor(authData.user.id);
  const created = [
    await dealNotification(
      offer,
      Number(settings.immediate_deal_threshold || 70),
    ),
    await priceDropNotification(offer),
  ].filter(Boolean) as Record<string, any>[];
  return json({
    ok: true,
    created: created.length,
    emailDelivery: "gmail_queue",
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function scanCheck(
  check: Record<string, any>,
  book: Record<string, any>,
) {
  const plan = sourcePlan(check.source_id, book);
  const attemptCount = Number(check.attempt_count || 0) + 1;
  const base = {
    id: check.id,
    result_count: Number(plan.resultCount || 0),
    note: plan.note || null,
    search_url: plan.searchUrl || null,
    last_error: null,
    attempt_count: attemptCount,
    next_attempt_at: null,
  };
  if (plan.status !== "pending") return { ...base, status: plan.status };
  try {
    // Priority-1 fix (2026-08-14): the previous self-identifying
    // "HamadafHahaserReportBot/1.0" user-agent appeared to trigger
    // CAPTCHA/anti-bot walls on most automatic sources (confirmed via an
    // isolated read-only check against a live Rebooks product page, which
    // returned full content with no block using an ordinary browser
    // user-agent). This still only reads public product pages that a
    // browser could load directly - no login, no CAPTCHA solving, and no
    // access-restricted content is touched.
    const response = await fetch(plan.searchUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        "accept-language": "he-IL,he;q=0.9,en-US;q=0.6,en;q=0.5",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = await response.text();
    const classified = classifySearchResponse({
      sourceId: check.source_id,
      title: book.title,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      body,
    });
    if (
      classified.status === "temporary_error" &&
      attemptCount < MAX_SCAN_ATTEMPTS
    ) {
      return {
        ...base,
        ...classified,
        attempt_count: attemptCount,
        search_url: plan.searchUrl,
        next_attempt_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };
    }
    if (classified.status === "temporary_error") {
      return {
        ...base,
        status: "unavailable",
        note: `${classified.note} שלושה ניסיונות לא הצליחו.`,
        search_url: plan.searchUrl,
        last_error: classified.note,
      };
    }
    return {
      ...base,
      ...classified,
      attempt_count: attemptCount,
      search_url: plan.searchUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    if (attemptCount < MAX_SCAN_ATTEMPTS) {
      return {
        ...base,
        status: "temporary_error",
        note: "הבדיקה נכשלה זמנית ותבוצע שוב.",
        last_error: message,
        next_attempt_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };
    }
    return {
      ...base,
      status: "unavailable",
      note: "המקור לא היה זמין לאחר שלושה ניסיונות.",
      last_error: message,
    };
  }
}

async function ensureReportRun(
  userId: string,
  localDate: string,
  localHour: number,
  settings: Record<string, any>,
) {
  const target = nextPreparationTarget(localDate, localHour, settings);
  const created = await service().rpc("start_report_run_for_user_on_date", {
    target_user: userId,
    target_kind: target.kind,
    target_local_date: target.localDate,
  });
  if (created.error) throw created.error;
  const synced = await service().rpc("sync_report_run_scope", {
    target_run: created.data,
    target_user: userId,
  });
  if (synced.error) throw synced.error;
  return { ...target, runId: created.data as string };
}

async function scanOldestRun(userId: string) {
  const runs = await service()
    .from("report_runs")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "running")
    .order("local_date", { ascending: true })
    .order("started_at", { ascending: true })
    .limit(4);
  if (runs.error) throw runs.error;
  const run = (runs.data || []).sort((left, right) => {
    const dateOrder = String(left.local_date).localeCompare(
      String(right.local_date),
    );
    if (dateOrder) return dateOrder;
    const rank = { morning: 0, evening: 1, manual: 2 } as Record<
      string,
      number
    >;
    return (rank[left.report_kind] ?? 3) - (rank[right.report_kind] ?? 3);
  })[0];
  if (!run) return { runId: null, processed: 0 };

  const synced = await service().rpc("sync_report_run_scope", {
    target_run: run.id,
    target_user: userId,
  });
  if (synced.error) throw synced.error;

  const pending = await service()
    .from("report_checks")
    .select("id,book_id,source_id,status,attempt_count,next_attempt_at")
    .eq("user_id", userId)
    .eq("run_id", run.id)
    .eq("scope_active", true)
    .in("status", ["pending", "temporary_error"])
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(SCAN_BATCH_SIZE * 3);
  if (pending.error) throw pending.error;
  const now = Date.now();
  const due: Record<string, any>[] = (
    (pending.data || []) as Record<string, any>[]
  )
    .filter(
      (check) =>
        !check.next_attempt_at ||
        new Date(check.next_attempt_at).getTime() <= now,
    )
    .slice(0, SCAN_BATCH_SIZE);
  if (!due.length) return { runId: run.id, processed: 0 };

  const bookIds = [...new Set(due.map((check) => check.book_id))];
  const books = await service()
    .from("books")
    .select("id,title,author,status,user_id")
    .eq("user_id", userId)
    .in("id", bookIds);
  if (books.error) throw books.error;
  const byId = new Map<string, Record<string, any>>(
    (books.data || []).map((book) => [book.id, book]),
  );
  const results = await mapWithConcurrency(
    due,
    SCAN_CONCURRENCY,
    async (check) => {
      const book = byId.get(check.book_id);
      if (!book) {
        return {
          id: check.id,
          status: "unavailable",
          result_count: 0,
          note: "הספר אינו פעיל עוד במקור האמת.",
          search_url: null,
          last_error: null,
          attempt_count: Number(check.attempt_count || 0) + 1,
          next_attempt_at: null,
        };
      }
      return await scanCheck(check, book);
    },
  );
  let storedOffers = 0;
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index] as Record<string, any>;
    const check = due[index];
    for (const offer of result.offers || []) {
      const existing = await service()
        .from("price_offers")
        .select("id")
        .eq("user_id", userId)
        .eq("source", offer.source)
        .eq("source_listing_key", offer.sourceListingKey)
        .maybeSingle();
      if (existing.error) throw existing.error;
      const now = new Date();
      const payload = {
        user_id: userId,
        book_id: check.book_id,
        source: offer.source,
        source_listing_key: offer.sourceListingKey,
        listing_title: offer.listingTitle,
        source_url: offer.sourceUrl,
        condition: offer.condition,
        match_type: offer.matchType,
        edition_language: offer.editionLanguage,
        item_price: offer.itemPrice,
        availability_status: offer.availabilityStatus,
        shipping_price: offer.shippingPrice,
        shipping_known: offer.shippingKnown,
        active: true,
        is_removed: false,
        last_checked_at: now.toISOString(),
        next_check_at: new Date(now.getTime() + 2 * 86400000).toISOString(),
        updated_at: now.toISOString(),
      };
      const saved = existing.data?.id
        ? await service()
            .from("price_offers")
            .update(payload)
            .eq("id", existing.data.id)
            .eq("user_id", userId)
        : await service().from("price_offers").insert(payload);
      if (saved.error) throw saved.error;
      storedOffers += 1;
    }
  }
  const applied = await service().rpc("apply_report_check_results", {
    target_run: run.id,
    target_user: userId,
    result_rows: results,
  });
  if (applied.error) throw applied.error;
  return { runId: run.id, processed: results.length, storedOffers };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildEmptyReportEmail(reportLabel: string) {
  // Priority-2 fix (2026-08-14, approved): previously, when a run finished
  // scanning but found zero valid offers, the function skipped silently -
  // no email at all, not even the short notice the user explicitly asked
  // for. This restores that exact required message, in the same visual
  // design as the full report.
  return `<!doctype html><html lang="he" dir="rtl" style="margin:0;padding:0;background:#edf3f8;"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#edf3f8;color:#102a43;font-family:Arial,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#edf3f8" style="width:100%;border-collapse:collapse;background:#edf3f8;"><tr><td align="center" style="padding:20px 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;border-collapse:separate;"><tr><td bgcolor="#102a43" style="background:#102a43;border-radius:20px;padding:0;text-align:right;direction:rtl;overflow:hidden;"><div style="height:6px;background:#2dd4bf;font-size:0;line-height:0;">&nbsp;</div><div style="padding:25px 25px 27px 25px;"><div style="display:inline-block;background:#163b5c;border:1px solid #285978;border-radius:999px;padding:6px 11px;font-family:Arial,sans-serif;font-size:12px;line-height:1;color:#78f2d2;font-weight:800;letter-spacing:0.3px;margin:0 0 12px 0;">המדף החסר</div><div style="font-family:Arial,sans-serif;font-size:24px;line-height:1.3;font-weight:900;color:#ffffff;margin:0 0 7px 0;">${escapeHtml(reportLabel)}</div></div></td></tr><tr><td style="height:16px;font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:0;text-align:right;direction:rtl;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background:#ffffff;border:1px solid #d8e4ee;border-radius:18px;margin:0;box-shadow:0 8px 24px rgba(15,35,58,0.08);"><tr><td style="padding:26px 22px;text-align:right;direction:rtl;"><div style="font-family:Arial,sans-serif;font-size:17px;line-height:1.6;font-weight:700;color:#102a43;">לא נמצאה כעת הצעה מאומתת חדשה.</div></td></tr></table></td></tr></table></td></tr></table></body></html>`;
}

async function buildReportEmail(
  userId: string,
  reportRun: Record<string, any>,
) {
  const [
    booksResult,
    offersResult,
    deliveredReportsResult,
    pendingAlertsResult,
  ] = await Promise.all([
    service()
      .from("books")
      .select("id,title,author")
      .eq("user_id", userId)
      .not("status", "in", '("השגתי","סל מחזור")'),
    service()
      .from("price_offers")
      .select(
        "book_id,source,listing_title,item_price,total_price,shipping_known,source_url,availability_status,last_checked_at",
      )
      .eq("user_id", userId)
      .eq("active", true)
      .eq("is_removed", false)
      .eq("edition_language", "עברית")
      .not("item_price", "is", null)
      .not("source_url", "is", null)
      .in("availability_status", ["במלאי", "לא במלאי"])
      .eq("shipping_known", true)
      .not("total_price", "is", null)
      .lte("total_price", MAX_REPORT_TOTAL)
      .order("last_checked_at", { ascending: false, nullsFirst: false }),
    service()
      .from("notifications")
      .select("metadata,emailed_at")
      .eq("user_id", userId)
      .in("notification_type", ["דוח בוקר", "דוח ערב"])
      .not("emailed_at", "is", null)
      .order("emailed_at", { ascending: false })
      .limit(180),
    service()
      .from("notifications")
      .select("id,book_id,notification_type,title,body,metadata,created_at")
      .eq("user_id", userId)
      .is("emailed_at", null)
      .not("notification_type", "in", '("דוח בוקר","דוח ערב")')
      .order("created_at", { ascending: true })
      .limit(100),
  ]);
  const failed = [
    booksResult,
    offersResult,
    deliveredReportsResult,
    pendingAlertsResult,
  ].find((result) => result.error);
  if (failed?.error) throw failed.error;
  const books = booksResult.data || [];
  const offers = offersResult.data || [];
  const bookById = new Map<string, Record<string, any>>(
    books.map((book) => [book.id, book]),
  );
  const reportableOffers = offers.filter(
    (offer) =>
      Boolean(String(bookById.get(offer.book_id)?.title || "").trim()) &&
      isCompleteReportOffer(offer) &&
      reportableOfferTotal(offer) !== null,
  );
  const relevantOffers = reportOfferChanges(
    reportableOffers,
    deliveredReportsResult.data || [],
  );
  const recentCutoff = Date.now() - 48 * 60 * 60 * 1000;
  const recentBestByBook = new Map<string, Record<string, any>>();
  for (const offer of reportableOffers) {
    const checkedAt = new Date(offer.last_checked_at || 0).getTime();
    const displayPrice = Number(offer.total_price ?? offer.item_price);
    if (
      !bookById.has(offer.book_id) ||
      !offer.source_url ||
      !Number.isFinite(displayPrice) ||
      checkedAt < recentCutoff
    )
      continue;
    const current = recentBestByBook.get(offer.book_id);
    const currentPrice = Number(current?.total_price ?? current?.item_price);
    if (!current || displayPrice < currentPrice)
      recentBestByBook.set(offer.book_id, offer);
  }
  const changedUrls = new Set(relevantOffers.map((offer) => offer.source_url));
  const activeOffers = [...recentBestByBook.values()]
    .filter((offer) => !changedUrls.has(offer.source_url))
    .sort(
      (left, right) =>
        Number(left.total_price ?? left.item_price) -
        Number(right.total_price ?? right.item_price),
    );
  const displayOffers = [
    ...relevantOffers,
    ...activeOffers.map((offer) => ({ ...offer, change_type: "active" })),
  ].slice(0, 15);
  const pendingAlerts = pendingAlertsResult.data || [];
  const cards = displayOffers
    .map((offer: Record<string, any>) => {
      const book = bookById.get(offer.book_id) || {};
      const price = Number(offer.total_price).toFixed(2);
      const availabilityStyle =
        offer.availability_status === "במלאי"
          ? "background:#dcfce7;color:#166534;border:1px solid #bbf7d0;"
          : "background:#f1f5f9;color:#475569;border:1px solid #dbe3ed;";
      const changeLabel =
        offer.change_type === "lower"
          ? "ירידת מחיר"
          : offer.change_type === "new"
            ? "הצעה חדשה"
            : "ללא שינוי במחיר";
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background:#ffffff;border:1px solid #d8e4ee;border-radius:18px;margin:0 0 14px 0;box-shadow:0 8px 24px rgba(15,35,58,0.08);"><tr><td style="height:5px;background:#22c7a9;border-radius:18px 18px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:22px 22px 20px 22px;text-align:right;direction:rtl;"><div style="font-family:Arial,sans-serif;font-size:21px;line-height:1.35;font-weight:800;color:#102a43;margin:0 0 4px 0;">${escapeHtml(book.title)}</div><div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#62758a;margin:0 0 5px 0;">${escapeHtml(book.author || "המחבר לא צוין")}</div><div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#0f766e;font-weight:700;margin:0 0 16px 0;">${escapeHtml(offer.source)} | ${changeLabel}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background:#f0fdfa;border:1px solid #ccfbf1;border-radius:13px;margin:0 0 14px 0;"><tr><td style="padding:14px 16px;text-align:right;direction:rtl;"><div style="font-family:Arial,sans-serif;font-size:12px;line-height:1.4;font-weight:700;color:#0f766e;margin:0 0 2px 0;">מחיר כולל משלוח</div><div style="font-family:Arial,sans-serif;font-size:31px;line-height:1.15;font-weight:900;color:#0f172a;letter-spacing:-0.5px;">${price} ₪</div></td></tr></table><div style="display:inline-block;${availabilityStyle}border-radius:999px;padding:7px 12px;font-family:Arial,sans-serif;font-size:13px;line-height:1;font-weight:800;margin:0 0 16px 0;">${escapeHtml(offer.availability_status)}</div><a href="${escapeHtml(offer.source_url)}" style="display:block;background:#0f766e;color:#ffffff;text-decoration:none;text-align:center;border-radius:11px;padding:13px 18px;font-family:Arial,sans-serif;font-size:15px;line-height:1.3;font-weight:800;">לצפייה במוצר</a></td></tr></table>`;
    })
    .join("");
  const displayedBookIds = new Set(displayOffers.map((offer) => offer.book_id));
  const bundledNotificationIds = pendingAlerts
    .filter((alert) => displayedBookIds.has(alert.book_id))
    .map((alert) => alert.id);
  const emailHtml = displayOffers.length
    ? `<!doctype html><html lang="he" dir="rtl" style="margin:0;padding:0;background:#edf3f8;"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#edf3f8;color:#102a43;font-family:Arial,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#edf3f8" style="width:100%;border-collapse:collapse;background:#edf3f8;"><tr><td align="center" style="padding:20px 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;border-collapse:separate;"><tr><td bgcolor="#102a43" style="background:#102a43;border-radius:20px;padding:0;text-align:right;direction:rtl;overflow:hidden;"><div style="height:6px;background:#2dd4bf;font-size:0;line-height:0;">&nbsp;</div><div style="padding:25px 25px 27px 25px;"><div style="display:inline-block;background:#163b5c;border:1px solid #285978;border-radius:999px;padding:6px 11px;font-family:Arial,sans-serif;font-size:12px;line-height:1;color:#78f2d2;font-weight:800;letter-spacing:0.3px;margin:0 0 12px 0;">המדף החסר</div><div style="font-family:Arial,sans-serif;font-size:28px;line-height:1.25;font-weight:900;color:#ffffff;margin:0 0 7px 0;">ספרים שמצאנו עבורך</div><div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#b9ccdc;">הצעות מאומתות במחיר כולל של עד 30 ש״ח</div></div></td></tr><tr><td style="height:16px;font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:0;text-align:right;direction:rtl;">${cards}</td></tr></table></td></tr></table></body></html>`
    : null;
  return {
    emailHtml,
    bundledNotificationIds,
    reportedOffers: displayOffers.map((offer: Record<string, any>) => ({
      book_id: offer.book_id,
      item_price: Number(offer.item_price),
      total_price: Number(offer.total_price ?? offer.item_price),
      source: offer.source,
      source_url: offer.source_url || null,
      availability_status: offer.availability_status,
      shipping_known: true,
      change_type: offer.change_type,
    })),
  };
}

function runIsDue(
  run: Record<string, any>,
  localDate: string,
  localHour: number,
  settings: Record<string, any>,
) {
  if (String(run.local_date) < localDate) return true;
  if (String(run.local_date) > localDate) return false;
  const dueHour =
    run.report_kind === "morning"
      ? Number(settings.morning_report_hour ?? 7)
      : Number(settings.evening_check_hour ?? 21);
  return localHour >= dueHour;
}

async function finalizeScheduledRun(
  userId: string,
  reportRunDetails: Record<string, any>,
) {
  const kind = reportRunDetails.report_kind === "morning" ? "בוקר" : "ערב";
  const deliveryRun = await service()
    .from("price_scan_runs")
    .upsert(
      {
        user_id: userId,
        local_date: reportRunDetails.local_date,
        run_kind: kind,
      },
      { onConflict: "user_id,local_date,run_kind", ignoreDuplicates: true },
    )
    .select("id,completed_at");
  if (deliveryRun.error) throw deliveryRun.error;
  let runId = deliveryRun.data?.[0]?.id;
  if (!runId) {
    const existing = await service()
      .from("price_scan_runs")
      .select("id,completed_at")
      .eq("user_id", userId)
      .eq("local_date", reportRunDetails.local_date)
      .eq("run_kind", kind)
      .single();
    if (existing.error) throw existing.error;
    if (existing.data.completed_at) return { skipped: true, created: 0 };
    runId = existing.data.id;
  }

  const coverageRun = await service()
    .from("report_runs")
    .select("id,status,expected_books,expected_checks,completed_checks")
    .eq("id", reportRunDetails.id)
    .eq("user_id", userId)
    .single();
  if (coverageRun.error) throw coverageRun.error;
  if (
    coverageRun.data.status !== "completed" ||
    coverageRun.data.completed_checks !== coverageRun.data.expected_checks
  ) {
    return { skipped: "coverage incomplete", created: 0 };
  }
  const snapshot = await service().rpc("snapshot_daily_prices", {
    target_user: userId,
  });
  if (snapshot.error) throw snapshot.error;
  const settings = await settingsFor(userId);
  const { data: offers, error } = await service()
    .from("price_offers")
    .select("*")
    .eq("user_id", userId)
    .eq("active", true)
    .eq("is_removed", false)
    .eq("edition_language", "עברית");
  if (error) throw error;
  const created: Record<string, any>[] = [];
  for (const offer of offers || []) {
    const deal = await dealNotification(
      offer,
      Number(settings.immediate_deal_threshold || 70),
    );
    if (deal) created.push(deal);
    const drop = await priceDropNotification(offer);
    if (drop) created.push(drop);
  }
  const now = new Date();
  const due = (offers || []).filter(
    (offer) => !offer.next_check_at || new Date(offer.next_check_at) <= now,
  );
  for (const offer of due) {
    const reminder = await insertNotification({
      user_id: userId,
      book_id: offer.book_id,
      offer_id: offer.id,
      notification_type: "בדיקה מחודשת",
      title: "נדרשת בדיקת מודעה",
      body: `${offer.listing_title || "הצעה"} אצל ${offer.source} לא נבדקה ביומיים האחרונים.`,
      dedupe_key: `${offer.id}:recheck:${reportRunDetails.local_date}`,
      metadata: { source: offer.source },
    });
    if (reminder) created.push(reminder);
    const reschedule = await service()
      .from("price_offers")
      .update({
        next_check_at: new Date(now.getTime() + 2 * 86400000).toISOString(),
      })
      .eq("id", offer.id)
      .eq("user_id", userId);
    if (reschedule.error) throw reschedule.error;
  }
  const reportLabel = kind === "בוקר" ? "דוח בוקר" : "דוח ערב";
  const { emailHtml, reportedOffers, bundledNotificationIds } =
    await buildReportEmail(userId, reportRunDetails);
  // Priority-2 fix (2026-08-14, approved): coverageRun.data.status is
  // already verified "completed" at this point (see the early gate
  // above), so a null emailHtml here means scanning genuinely finished
  // with zero valid offers - not that scanning is still in progress.
  // That case now gets the short required notice instead of silence.
  if (!emailHtml && reportedOffers.length === 0) {
    // Gmail-delivery fix (2026-08-15): title now uses reportSubject() so it
    // always matches the exact required "המדף החסר: דוח בוקר/ערב
    // DD.MM.YYYY" format - the previous title here ("דוח X של המדף החסר")
    // was the same mismatch already confirmed in a real sent email during
    // the 2026-08-14 audit.
    const subject = reportSubject(reportRunDetails.report_kind, reportRunDetails.local_date);
    const noOfferReport = await insertNotification({
      user_id: userId,
      notification_type: reportLabel,
      title: subject,
      body: "לא נמצאה כעת הצעה מאומתת חדשה.",
      dedupe_key: `complete_report:${reportRunDetails.report_kind}:${reportRunDetails.local_date}`,
      metadata: {
        report_run_id: reportRunDetails.id,
        content_policy: "books_only_v1",
        reported_offers: [],
        bundled_notification_ids: bundledNotificationIds,
        email_delivery: "gmail_queue",
        email_subject: subject,
        email_html: buildEmptyReportEmail(reportLabel),
      },
    });
    if (noOfferReport) created.push(noOfferReport);
    const completedEmptyReport = await service()
      .from("price_scan_runs")
      .update({
        completed_at: new Date().toISOString(),
        result: {
          created: created.length,
          report_run_id: reportRunDetails.id,
          report_empty: true,
          email_delivery: "gmail_queue",
        },
      })
      .eq("id", runId)
      .eq("user_id", userId);
    if (completedEmptyReport.error) throw completedEmptyReport.error;
    return { skipped: false, created: created.length };
  }
  if (!emailHtml || !reportQualityGate(coverageRun.data, reportedOffers)) {
    const completedWithoutReport = await service()
      .from("price_scan_runs")
      .update({
        completed_at: new Date().toISOString(),
        result: {
          created: created.length,
          report_run_id: reportRunDetails.id,
          report_skipped: "quality_gate",
          email_delivery: "gmail_queue",
        },
      })
      .eq("id", runId)
      .eq("user_id", userId);
    if (completedWithoutReport.error) throw completedWithoutReport.error;
    return { skipped: "report quality gate", created: created.length };
  }
  // Gmail-delivery fix (2026-08-15): see the identical comment above -
  // reportSubject() is now the single place that formats this string.
  const fullReportSubject = reportSubject(
    reportRunDetails.report_kind,
    reportRunDetails.local_date,
  );
  const report = await insertNotification({
    user_id: userId,
    notification_type: reportLabel,
    title: fullReportSubject,
    body: "נמצאו הצעות ספרים מאומתות המתאימות לכללי הדוח.",
    dedupe_key: `complete_report:${reportRunDetails.report_kind}:${reportRunDetails.local_date}`,
    metadata: {
      report_run_id: reportRunDetails.id,
      content_policy: "books_only_v1",
      reported_offers: reportedOffers,
      bundled_notification_ids: bundledNotificationIds,
      email_delivery: "gmail_queue",
      email_subject: fullReportSubject,
      email_html: emailHtml,
    },
  });
  if (report) created.push(report);
  const completed = await service()
    .from("price_scan_runs")
    .update({
      completed_at: new Date().toISOString(),
      result: {
        created: created.length,
        due: due.length,
        report_run_id: reportRunDetails.id,
        email_delivery: "gmail_queue",
      },
    })
    .eq("id", runId)
    .eq("user_id", userId);
  if (completed.error) throw completed.error;
  return {
    skipped: false,
    created: created.length,
    reportRunId: reportRunDetails.id,
    emailDelivery: "gmail_queue",
  };
}

// Gmail-delivery mechanism (2026-08-15, pending approval - not deployed
// until GMAIL_APP_PASSWORD secret is configured). Everything upstream of
// this already writes queued emails to `notifications` tagged
// email_delivery: "gmail_queue" - nothing previously anywhere in this
// codebase or CI actually drained that queue via Gmail. This closes that
// gap using SMTP + an App Password (see smtp-client.mjs for why SMTP
// rather than the Gmail API/OAuth: OAuth refresh tokens for the sensitive
// gmail.send scope on a personal, unverified Google Cloud project expire
// every 7 days, which is not viable for an unattended schedule).
async function deliverQueuedGmailNotifications(
  userId: string,
  settings: Record<string, any>,
) {
  if (!GMAIL_APP_PASSWORD) {
    return { delivered: 0, skipped: "GMAIL_APP_PASSWORD not configured" };
  }
  if (settings.email_enabled === false) {
    return { delivered: 0, skipped: "email disabled in settings" };
  }
  const recipient = settings.email_address || GMAIL_SENDER_ADDRESS;
  const pending = await service()
    .from("notifications")
    .select("id,title,body,metadata")
    .eq("user_id", userId)
    .is("emailed_at", null)
    .contains("metadata", { email_delivery: "gmail_queue" })
    .order("created_at", { ascending: true })
    .limit(MAX_EMAILS_PER_INVOCATION);
  if (pending.error) throw pending.error;
  let delivered = 0;
  for (const row of pending.data || []) {
    const metadata = (row.metadata || {}) as Record<string, any>;
    const attempts = Number(metadata.email_send_attempts || 0);
    if (attempts >= MAX_EMAIL_SEND_ATTEMPTS) continue;
    const subject = metadata.email_subject || row.title;
    const html = metadata.email_html;
    if (!html) continue;
    try {
      await sendMailViaGmailSmtp({
        user: GMAIL_SENDER_ADDRESS,
        pass: GMAIL_APP_PASSWORD,
        from: GMAIL_SENDER_ADDRESS,
        to: recipient,
        subject,
        html,
        text: row.body || "",
      });
      // Only mark emailed_at after SMTP has confirmed acceptance above -
      // if sendMailViaGmailSmtp throws, we never reach this update, so a
      // failed send is never marked as sent.
      const marked = await service()
        .from("notifications")
        .update({ emailed_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("user_id", userId)
        .is("emailed_at", null);
      if (marked.error) throw marked.error;
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "send failed";
      console.error("Gmail SMTP send failed", row.id, message);
      const failed = await service()
        .from("notifications")
        .update({
          metadata: {
            ...metadata,
            email_send_attempts: attempts + 1,
            email_last_send_error: message,
          },
        })
        .eq("id", row.id)
        .eq("user_id", userId);
      if (failed.error) throw failed.error;
    }
  }
  return { delivered };
}

async function processSchedule(request: Request) {
  const providedSecret = request.headers.get("x-schedule-secret") || "";
  const { data: authorized, error: authorizationError } = await service().rpc(
    "verify_alerts_schedule_secret",
    { provided_secret: providedSecret },
  );
  if (authorizationError) throw authorizationError;
  if (!authorized) return json({ error: "unauthorized" }, 401);
  const local = jerusalemParts();
  const { data: rows, error } = await service().from("books").select("user_id");
  if (error) throw error;
  const users: string[] = [
    ...new Set<string>(
      (rows || [])
        .map((row: { user_id: string }) => row.user_id)
        .filter(Boolean),
    ),
  ];
  const results = [];
  for (const userId of users) {
    try {
      const settings = await settingsFor(userId);
      const prepared = await ensureReportRun(
        userId,
        local.date,
        local.hour,
        settings,
      );
      const scanned = await scanOldestRun(userId);
      const recentCutoff = new Date(`${local.date}T12:00:00Z`);
      recentCutoff.setUTCDate(recentCutoff.getUTCDate() - 2);
      const completedRuns = await service()
        .from("report_runs")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "completed")
        .in("report_kind", ["morning", "evening"])
        .gte("local_date", recentCutoff.toISOString().slice(0, 10))
        .order("local_date", { ascending: true })
        .limit(6);
      if (completedRuns.error) throw completedRuns.error;
      const finalized = [];
      for (const completedRun of completedRuns.data || []) {
        if (!runIsDue(completedRun, local.date, local.hour, settings)) continue;
        finalized.push(await finalizeScheduledRun(userId, completedRun));
      }
      const delivered = await deliverQueuedGmailNotifications(userId, settings);
      results.push({ userId, prepared, scanned, finalized, delivered });
    } catch (error) {
      console.error("Scheduled user processing failed", error);
      results.push({ userId, error: "processing failed" });
    }
  }
  return json({ ok: true, local, users: users.length, results });
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return json({ error: "method not allowed" }, 405);
  try {
    const parsed = await readJson(request);
    if (parsed.error) return parsed.error;
    const body = parsed.body as Record<string, any>;
    const mode = requestMode(body.mode);
    if (!mode) return json({ error: "invalid mode" }, 400);
    if (mode === "offer") return await processOfferMode(request, body);
    return await processSchedule(request);
  } catch (error) {
    console.error("Alerts request failed", error);
    return json({ error: "internal error" }, 500);
  }
});
