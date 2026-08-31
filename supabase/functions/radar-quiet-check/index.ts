import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.9";
import { sendMailViaGmailSmtp } from "./smtp-client.mjs";

// רדאר המדף - "יום שקט" check (section 5 of the handoff doc). Fully
// separate from supabase/functions/alerts - does not read, write, or
// schedule anything shared with it. Runs once a day (22:00 IDT, per
// explicit approval): if no manual_offers row was created today, emails
// a reminder to check if the wanted books ran out. Reuses the same Gmail
// SMTP mechanism and notifications table pattern as alerts (SSOT), but
// through its own dedupe_key/notification_type so the two never collide.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GMAIL_SENDER_ADDRESS =
  Deno.env.get("GMAIL_SENDER_ADDRESS") || "toxic2004@gmail.com";

let serviceClient: ReturnType<typeof createClient> | null = null;
function service() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("Missing required Supabase service configuration");
  }
  if (!serviceClient) {
    serviceClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });
  }
  return serviceClient;
}

async function gmailAppPassword(): Promise<string> {
  const { data, error } = await service().rpc("get_gmail_app_password");
  if (error) throw error;
  return (data as string | null) || "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// Israel local calendar date (not UTC) - a day that started at 22:00 UTC
// the previous evening is still "today" in Israel, and this check runs
// at 22:00 IDT, so using the UTC date directly would be wrong for most
// of the day.
function israelLocalDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

async function checkUser(userId: string, localDate: string) {
  const dayStart = new Date(`${localDate}T00:00:00+03:00`).toISOString();
  const { data: todaysOffers, error: offersError } = await service()
    .from("manual_offers")
    .select("id")
    .eq("user_id", userId)
    .gte("entered_at", dayStart)
    .limit(1);
  if (offersError) throw offersError;
  if ((todaysOffers || []).length > 0) {
    return { userId, quiet: false };
  }

  const dedupeKey = `radar_quiet_day:${localDate}`;
  const title = "רדאר המדף: יום שקט";
  const body =
    "לא הוזנה היום אף הצעה ברדאר המדף. ייתכן שנגמרו הספרים המבוקשים בקבוצות הפייסבוק - שווה לבדוק.";
  const subject = `רדאר המדף: יום שקט - ${localDate}`;
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="font-family:Assistant,Rubik,sans-serif;background:#fff7e0;padding:20px;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;border:1px solid #f0e6c8;">
      <h2 style="margin-top:0;">רדאר המדף 📡</h2>
      <p>לא הוזנה היום (${localDate}) אף הצעה חדשה ברדאר המדף.</p>
      <p>ייתכן שנגמרו הספרים המבוקשים בקבוצות הפייסבוק, או שפשוט לא הייתה הצעה רלוונטית היום - שווה בדיקה.</p>
    </div>
  </body></html>`;

  const inserted = await service()
    .from("notifications")
    .insert({
      user_id: userId,
      notification_type: "radar_quiet_day",
      title,
      body,
      dedupe_key: dedupeKey,
      metadata: {
        email_delivery: "gmail_queue",
        email_subject: subject,
        email_html: html,
      },
    })
    .select("id")
    .single();

  // A unique-violation here means this user's quiet-day notification for
  // today already exists (e.g. a retried invocation) - not an error,
  // just nothing new to send.
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      return { userId, quiet: true, alreadyNotified: true };
    }
    throw inserted.error;
  }

  const { data: settingsRow } = await service()
    .from("notification_settings")
    .select("email_enabled,email_address")
    .eq("user_id", userId)
    .maybeSingle();
  const settings = settingsRow || {};
  if (settings.email_enabled === false) {
    return { userId, quiet: true, emailed: false, reason: "email disabled" };
  }

  const appPassword = await gmailAppPassword();
  if (!appPassword) {
    return {
      userId,
      quiet: true,
      emailed: false,
      reason: "GMAIL_APP_PASSWORD not configured",
    };
  }

  await sendMailViaGmailSmtp({
    user: GMAIL_SENDER_ADDRESS,
    pass: appPassword,
    from: GMAIL_SENDER_ADDRESS,
    to: settings.email_address || GMAIL_SENDER_ADDRESS,
    subject,
    html,
    text: body,
  });

  const marked = await service()
    .from("notifications")
    .update({ emailed_at: new Date().toISOString() })
    .eq("id", inserted.data.id)
    .eq("user_id", userId)
    .is("emailed_at", null);
  if (marked.error) throw marked.error;

  return { userId, quiet: true, emailed: true };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }
  try {
    const providedSecret = request.headers.get("x-schedule-secret") || "";
    const { data: authorized, error: authorizationError } = await service().rpc(
      "verify_alerts_schedule_secret",
      { provided_secret: providedSecret },
    );
    if (authorizationError) throw authorizationError;
    if (!authorized) return json({ error: "unauthorized" }, 401);

    const localDate = israelLocalDate(new Date());
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
        results.push(await checkUser(userId, localDate));
      } catch (error) {
        console.error("radar-quiet-check: user check failed", error);
        results.push({ userId, error: "check failed" });
      }
    }
    return json({ ok: true, localDate, results });
  } catch (error) {
    console.error("radar-quiet-check: request failed", error);
    return json({ error: "internal error" }, 500);
  }
});
