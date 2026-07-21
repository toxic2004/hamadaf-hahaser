import { createClient } from "npm:@supabase/supabase-js@2";
import {
  assertEmailAccepted,
  dealDedupeKey,
  dealTotal,
  isUuid,
  jerusalemParts,
  priceDrop,
  priceDropDedupeKey,
  requestMode,
  scheduledKinds,
} from "./core.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const EMAIL_FROM =
  Deno.env.get("ALERTS_EMAIL_FROM") || "המדף החסר <onboarding@resend.dev>";
const MAX_BODY_BYTES = 16_384;
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
      evening_check_hour: 19,
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

function escapeHtml(value: unknown) {
  return String(value || "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] || char,
  );
}

async function emailNotifications(
  userId: string,
  notifications: Record<string, any>[],
) {
  if (!notifications.length || !RESEND_API_KEY) return;
  const settings = await settingsFor(userId);
  if (!settings.email_enabled || !settings.email_address) return;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [settings.email_address],
      subject:
        notifications.length === 1
          ? notifications[0].title
          : `המדף החסר: ${notifications.length} התראות`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif">${notifications.map((item) => `<h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.body)}</p>`).join("")}</div>`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  assertEmailAccepted(response);
  const notificationIds = notifications
    .map((item) => item.id)
    .filter((id) => isUuid(id));
  if (!notificationIds.length) return;
  const { error } = await service()
    .from("notifications")
    .update({ emailed_at: new Date().toISOString() })
    .in("id", notificationIds);
  if (error) throw error;
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
  let emailError = false;
  try {
    await emailNotifications(authData.user.id, created);
  } catch (error) {
    emailError = true;
    console.error("Immediate email delivery failed", error);
  }
  return json({ ok: true, created: created.length, emailError });
}

async function processScheduledUser(
  userId: string,
  localDate: string,
  kind: "בוקר" | "ערב",
) {
  const run = await service()
    .from("price_scan_runs")
    .upsert(
      { user_id: userId, local_date: localDate, run_kind: kind },
      { onConflict: "user_id,local_date,run_kind", ignoreDuplicates: true },
    )
    .select("id,completed_at");
  if (run.error) throw run.error;
  let runId = run.data?.[0]?.id;
  if (!runId) {
    const existing = await service()
      .from("price_scan_runs")
      .select("id,completed_at")
      .eq("user_id", userId)
      .eq("local_date", localDate)
      .eq("run_kind", kind)
      .single();
    if (existing.error) throw existing.error;
    if (existing.data.completed_at) return { skipped: true, created: 0 };
    runId = existing.data.id;
    const restart = await service()
      .from("price_scan_runs")
      .update({ started_at: new Date().toISOString(), result: {} })
      .eq("id", runId);
    if (restart.error) throw restart.error;
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
      dedupe_key: `${offer.id}:recheck:${localDate}`,
      metadata: { source: offer.source },
    });
    if (reminder) created.push(reminder);
    const reschedule = await service()
      .from("price_offers")
      .update({
        next_check_at: new Date(now.getTime() + 2 * 86400000).toISOString(),
      })
      .eq("id", offer.id);
    if (reschedule.error) throw reschedule.error;
  }
  if (kind === "בוקר") {
    const worthwhile = (offers || []).filter(
      (offer) =>
        Number(offer.deal_score || 0) >=
        Number(settings.immediate_deal_threshold || 70),
    ).length;
    const report = await insertNotification({
      user_id: userId,
      notification_type: "דוח בוקר",
      title: "דוח הבוקר של המדף החסר",
      body: `${offers?.length || 0} הצעות פעילות. ${worthwhile} עסקאות מעל הסף. ${due.length} הצעות דורשות בדיקה.`,
      dedupe_key: `morning:${localDate}`,
      metadata: {
        active_offers: offers?.length || 0,
        worthwhile,
        due: due.length,
      },
    });
    if (report) created.push(report);
  }
  let emailError = false;
  try {
    await emailNotifications(userId, created);
  } catch (error) {
    emailError = true;
    console.error(`Scheduled email delivery failed for ${userId}`, error);
  }
  const completed = await service()
    .from("price_scan_runs")
    .update({
      completed_at: new Date().toISOString(),
      result: {
        created: created.length,
        due: due.length,
        email_error: emailError,
      },
    })
    .eq("id", runId);
  if (completed.error) throw completed.error;
  return { skipped: false, created: created.length, emailError };
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
      const kinds = scheduledKinds(settings, local.hour) as ("בוקר" | "ערב")[];
      if (!kinds.length) {
        results.push({ userId, skipped: "outside configured user hours" });
        continue;
      }
      for (const kind of kinds) {
        results.push({
          userId,
          kind,
          ...(await processScheduledUser(userId, local.date, kind)),
        });
      }
    } catch (error) {
      console.error("Scheduled user processing failed", error);
      results.push({ error: "processing failed" });
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
