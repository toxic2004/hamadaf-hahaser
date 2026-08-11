import { createClient } from "npm:@supabase/supabase-js@2.110.9";
import {
  dealDedupeKey,
  dealTotal,
  isUuid,
  jerusalemParts,
  priceDrop,
  priceDropDedupeKey,
  requestMode,
} from "./core.mjs";
import {
  classifySearchResponse,
  nextPreparationTarget,
  sourcePlan,
} from "./scanner-core.mjs";

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
      email_enabled: false,
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
    const response = await fetch(plan.searchUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,application/json;q=0.8",
        "accept-language": "he-IL,he;q=0.9,en;q=0.6",
        "user-agent":
          "HamadafHahaserReportBot/1.0 (+read-only availability check)",
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
  const applied = await service().rpc("apply_report_check_results", {
    target_run: run.id,
    target_user: userId,
    result_rows: results,
  });
  if (applied.error) throw applied.error;
  return { runId: run.id, processed: results.length };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const CHECK_LABELS: Record<string, string> = {
  found: "נמצאה התאמה",
  not_found: "לא נמצאה תוצאה",
  login_required: "נדרשת כניסה",
  blocked: "המקור חסם גישה",
  unavailable: "המקור לא היה זמין",
  manual_required: "נדרשת בדיקה ידנית",
};

async function buildReportEmail(
  userId: string,
  reportRun: Record<string, any>,
) {
  const [booksResult, sourcesResult, checksResult, offersResult] =
    await Promise.all([
      service()
        .from("books")
        .select("id,title,author,priority,is_required")
        .eq("user_id", userId)
        .not("status", "in", '("השגתי","סל מחזור")')
        .order("priority", { ascending: false })
        .order("title"),
      service()
        .from("report_sources")
        .select("id,label,sort_order")
        .eq("active", true)
        .order("sort_order"),
      service()
        .from("report_checks")
        .select("book_id,source_id,status,note,search_url,result_count")
        .eq("user_id", userId)
        .eq("run_id", reportRun.id)
        .eq("scope_active", true),
      service()
        .from("price_offers")
        .select("book_id,source,listing_title,total_price,url,shipping_known")
        .eq("user_id", userId)
        .eq("active", true)
        .eq("is_removed", false)
        .eq("edition_language", "עברית")
        .not("total_price", "is", null)
        .order("total_price", { ascending: true }),
    ]);
  const failed = [booksResult, sourcesResult, checksResult, offersResult].find(
    (result) => result.error,
  );
  if (failed?.error) throw failed.error;
  const books = booksResult.data || [];
  const sources = sourcesResult.data || [];
  const checks = checksResult.data || [];
  const offers = offersResult.data || [];
  const checksByBook = new Map<string, Record<string, any>[]>();
  for (const check of checks) {
    const rows = checksByBook.get(check.book_id) || [];
    rows.push(check);
    checksByBook.set(check.book_id, rows);
  }
  const offersByBook = new Map<string, Record<string, any>[]>();
  for (const offer of offers) {
    const rows = offersByBook.get(offer.book_id) || [];
    if (rows.length < 3) rows.push(offer);
    offersByBook.set(offer.book_id, rows);
  }
  const sourceById = new Map<string, Record<string, any>>(
    sources.map((source) => [source.id, source]),
  );
  const found = checks.filter((check) => check.status === "found").length;
  const cards = books
    .map((book) => {
      const bookChecks = (checksByBook.get(book.id) || []).sort(
        (left, right) =>
          Number(sourceById.get(left.source_id)?.sort_order || 99) -
          Number(sourceById.get(right.source_id)?.sort_order || 99),
      );
      const sourceRows = bookChecks
        .map((check) => {
          const source = sourceById.get(check.source_id);
          const label = CHECK_LABELS[check.status] || check.status;
          const sourceLabel = escapeHtml(source?.label || check.source_id);
          const linked =
            check.search_url && check.status === "found"
              ? `<a href="${escapeHtml(check.search_url)}">${sourceLabel}</a>`
              : sourceLabel;
          const detail =
            check.status === "found" && check.note
              ? `<small>${escapeHtml(check.note)}</small>`
              : "";
          return `<li>${linked}: ${escapeHtml(label)}${detail}</li>`;
        })
        .join("");
      const ranked = offersByBook.get(book.id) || [];
      const offerRows = ranked.length
        ? `<div class="offers"><strong>הצעות פעילות:</strong> ${ranked
            .map((offer) => {
              const text = `${offer.source}: ${Number(offer.total_price).toFixed(2)} ₪`;
              return offer.url
                ? `<a href="${escapeHtml(offer.url)}">${escapeHtml(text)}</a>`
                : `<span>${escapeHtml(text)}</span>`;
            })
            .join("")}</div>`
        : "";
      return `<section><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml(book.author || "מחבר לא צוין")}</p>${offerRows}<ul>${sourceRows}</ul></section>`;
    })
    .join("");
  const label = reportRun.report_kind === "morning" ? "דוח בוקר" : "דוח ערב";
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f4f7f5;font-family:Arial,sans-serif;color:#17362d}main{max-width:760px;margin:auto;padding:20px}header{background:#164b3c;color:#fff;border-radius:18px;padding:22px}h1,h3{margin:0}header p,section p{margin:5px 0}.metrics{display:flex;gap:10px;margin:14px 0}.metric,section{background:#fff;border-radius:12px;padding:12px}.metric{flex:1}section{border:1px solid #d8e6e0;margin:12px 0}section h3,a{color:#176b55}.offers{background:#f0f8f5;padding:9px;border-radius:9px}.offers a,.offers span{margin-left:10px}ul{columns:2;padding-right:20px}li{margin:3px 0}small{display:block;color:#52665f}footer{text-align:center;color:#60756e;padding:18px}@media(max-width:600px){.metrics{display:block}.metric{margin:7px 0}ul{columns:1}}</style></head><body><main><header><h1>${label} של המדף החסר</h1><p>${escapeHtml(reportRun.local_date)}. כיסוי מלא של ${reportRun.completed_checks} מתוך ${reportRun.expected_checks} בדיקות.</p></header><div class="metrics"><div class="metric"><strong>${books.length}</strong><br>ספרים פעילים</div><div class="metric"><strong>${found}</strong><br>התאמות מקור</div><div class="metric"><strong>100%</strong><br>מצבי מקור</div></div>${cards}<footer>הדוח מבוסס על טבלת books של המדף החסר. מקורות שחוסמים גישה מסומנים במפורש ולא נעקפו.</footer></main></body></html>`;
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
  const worthwhile = (offers || []).filter(
    (offer) =>
      Number(offer.deal_score || 0) >=
      Number(settings.immediate_deal_threshold || 70),
  ).length;
  const reportLabel = kind === "בוקר" ? "דוח בוקר" : "דוח ערב";
  const emailHtml = await buildReportEmail(userId, reportRunDetails);
  const report = await insertNotification({
    user_id: userId,
    notification_type: reportLabel,
    title: `${reportLabel} של המדף החסר`,
    body: `הושלם כיסוי מלא עבור ${reportRunDetails.expected_books} ספרים ו ${reportRunDetails.expected_checks} בדיקות מקור. ${offers?.length || 0} הצעות פעילות. ${worthwhile} עסקאות מעל הסף.`,
    dedupe_key: `complete_report:${reportRunDetails.report_kind}:${reportRunDetails.local_date}`,
    metadata: {
      report_run_id: reportRunDetails.id,
      expected_books: reportRunDetails.expected_books,
      expected_checks: reportRunDetails.expected_checks,
      completed_checks: reportRunDetails.completed_checks,
      coverage_percent: 100,
      active_offers: offers?.length || 0,
      worthwhile,
      due: due.length,
      email_delivery: "gmail_queue",
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
      results.push({ userId, prepared, scanned, finalized });
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
