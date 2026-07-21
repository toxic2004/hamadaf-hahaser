import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SCHEDULE_SECRET = Deno.env.get("ALERTS_SCHEDULE_SECRET") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const EMAIL_FROM =
  Deno.env.get("ALERTS_EMAIL_FROM") || "המדף החסר <onboarding@resend.dev>";
const service = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jerusalemParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
}

async function settingsFor(userId: string) {
  const { data } = await service
    .from("notification_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
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
  const { data, error } = await service
    .from("notifications")
    .upsert(row, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
    .select("*");
  if (error) throw error;
  return data?.[0] || null;
}

async function priceDropNotification(offer: Record<string, any>) {
  const { data } = await service
    .from("price_history")
    .select("total_price,captured_on")
    .eq("offer_id", offer.id)
    .not("total_price", "is", null)
    .order("captured_on", { ascending: false })
    .limit(2);
  if (!data || data.length < 2) return null;
  const current = Number(data[0].total_price);
  const previous = Number(data[1].total_price);
  if (!(current < previous)) return null;
  return insertNotification({
    user_id: offer.user_id,
    book_id: offer.book_id,
    offer_id: offer.id,
    notification_type: "ירידת מחיר",
    title: "ירידת מחיר",
    body: `המחיר ירד מ ${previous.toFixed(2)} ₪ ל ${current.toFixed(2)} ₪ אצל ${offer.source}`,
    dedupe_key: `${offer.id}:drop:${current}`,
    metadata: {
      previous_price: previous,
      total_price: current,
      source: offer.source,
    },
  });
}

async function dealNotification(offer: Record<string, any>, threshold: number) {
  const total = offer.total_price === null ? null : Number(offer.total_price);
  if (
    offer.edition_language !== "עברית" ||
    offer.match_type === "לא התאמה" ||
    !offer.active ||
    offer.is_removed ||
    total === null ||
    Number(offer.deal_score || 0) < threshold
  )
    return null;
  return insertNotification({
    user_id: offer.user_id,
    book_id: offer.book_id,
    offer_id: offer.id,
    notification_type: "עסקה משתלמת",
    title: "נמצאה עסקה משתלמת",
    body: `${offer.listing_title || "ספר"}: ${total.toFixed(2)} ₪ אצל ${offer.source}`,
    dedupe_key: `${offer.id}:deal:${total}`,
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
  });
  if (!response.ok) throw new Error(`Email failed with ${response.status}`);
  await service
    .from("notifications")
    .update({ emailed_at: new Date().toISOString() })
    .in(
      "id",
      notifications.map((item) => item.id),
    );
}

async function processOfferMode(request: Request, body: Record<string, any>) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization || !body.offerId)
    return json({ error: "unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { authorization } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "unauthorized" }, 401);
  const { data: offer, error } = await service
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
  const run = await service
    .from("price_scan_runs")
    .upsert(
      { user_id: userId, local_date: localDate, run_kind: kind },
      { onConflict: "user_id,local_date,run_kind", ignoreDuplicates: true },
    )
    .select("id,completed_at");
  if (run.error) throw run.error;
  let runId = run.data?.[0]?.id;
  if (!runId) {
    const existing = await service
      .from("price_scan_runs")
      .select("id,completed_at")
      .eq("user_id", userId)
      .eq("local_date", localDate)
      .eq("run_kind", kind)
      .single();
    if (existing.error) throw existing.error;
    if (existing.data.completed_at) return { skipped: true, created: 0 };
    runId = existing.data.id;
    await service
      .from("price_scan_runs")
      .update({ started_at: new Date().toISOString(), result: {} })
      .eq("id", runId);
  }
  await service.rpc("snapshot_daily_prices", { target_user: userId });
  const settings = await settingsFor(userId);
  const { data: offers, error } = await service
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
    await service
      .from("price_offers")
      .update({
        next_check_at: new Date(now.getTime() + 2 * 86400000).toISOString(),
      })
      .eq("id", offer.id);
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
  await service
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
  return { skipped: false, created: created.length, emailError };
}

async function processSchedule(request: Request) {
  if (
    !SCHEDULE_SECRET ||
    request.headers.get("x-schedule-secret") !== SCHEDULE_SECRET
  )
    return json({ error: "unauthorized" }, 401);
  const local = jerusalemParts();
  if (![7, 19].includes(local.hour))
    return json({ ok: true, skipped: "outside configured local hours", local });
  const kind = local.hour === 7 ? "בוקר" : "ערב";
  const { data: rows, error } = await service.from("books").select("user_id");
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
      results.push({
        userId,
        ...(await processScheduledUser(userId, local.date, kind)),
      });
    } catch (error) {
      console.error(`Scheduled processing failed for ${userId}`, error);
      results.push({ userId, error: "processing failed" });
    }
  }
  return json({ ok: true, local, kind, users: users.length, results });
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return json({ error: "method not allowed" }, 405);
  try {
    const body = await request.json().catch(() => ({}));
    if (body.mode === "offer") return await processOfferMode(request, body);
    return await processSchedule(request);
  } catch (error) {
    console.error(error);
    return json({ error: "internal error" }, 500);
  }
});
