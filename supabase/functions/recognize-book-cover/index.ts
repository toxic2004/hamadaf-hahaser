import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.9";

// Switched from OpenAI (gpt-5-mini) to Claude (claude-haiku-4-5-20251001)
// on 2026-09-02 after the OpenAI account ran out of credits (429
// insufficient_quota / credit_balance_exhausted, confirmed in
// function_logs). Mirrors the exact working Anthropic call pattern
// already proven in supabase/functions/radar-image-ingest
// (extraction-core.mjs): same endpoint, same header shape, same
// get_anthropic_api_key() RPC pulling the key from Supabase Vault - no
// new key or secret needed. The request/response contract with the
// browser (imageDataUrl in, {candidates:[...]} out) is unchanged, so
// cover-recognition.js required no changes.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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

async function anthropicApiKey(): Promise<string> {
  const { data, error } = await service().rpc("get_anthropic_api_key");
  if (error) throw error;
  return (data as string | null) || "";
}

function parseJsonObject(text: string): any {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

const PROMPT = [
  "זהה את הספר שבתמונת הכריכה.",
  "המטרה היא לזהות את זהות הספר, לא לתמלל את כל הטקסט.",
  "התעלם מהמלצות, ציטוטים, מדבקות מחיר, שם ההוצאה וטקסט שיווקי.",
  "שים לב: בכריכות רבות (בעיקר ספרי עיון של מחברים מוכרים) שם המחבר מודפס בגופן גדול ובולט יותר מהכותרת עצמה, לפעמים אפילו בראש העמוד. אל תניח ששם בגודל גדול הוא שם הספר רק בגלל גודלו.",
  "כותרת הספר היא לרוב הביטוי התיאורי שמופיע בנפרד (לעיתים עם כותרת משנה מתחתיו), ולא שם של אדם. אם יש טקסט שנראה כמו שם פרטי ושם משפחה של אדם וגם טקסט תיאורי נפרד, ברירת המחדל: הטקסט התיאורי הוא שם הספר, ושם האדם הוא המחבר.",
  "ודא שאיות השם (מחבר וכותרת) מדויק לפי מיטב ידיעתך על ספרים וסופרים מוכרים - אל תשער אותיות בגלל פונט מעוצב או קומיקסי, אם אתה מזהה שם מוכר (למשל של סופר ידוע) העדף את האיות הנכון והמוכר שלו.",
  "החזר JSON בלבד ובדיוק במבנה הבא, ללא טקסט נוסף לפני או אחרי:",
  '{"candidates":[{"title":"שם הספר","author":"שם המחבר","language":"he","confidence":0.0,"reason":"הסבר קצר"}]}',
  "החזר אפשרות אחת כשאתה בטוח, ועד שלוש אפשרויות במקרה של ספק.",
  "confidence חייב להיות מספר בין 0 ל-1.",
  "אל תמציא. אם לא ניתן לזהות, החזר candidates כמערך ריק.",
].join("\n");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > 10_000_000) return json({ error: "התמונה גדולה מדי." }, 413);

    const { imageDataUrl } = await req.json();
    if (typeof imageDataUrl !== "string") return json({ error: "לא התקבלה תמונה." }, 400);

    const match = imageDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return json({ error: "סוג התמונה אינו נתמך." }, 400);
    if (match[2].length > 9_000_000) return json({ error: "התמונה גדולה מדי." }, 413);

    const mediaType = match[1];
    const imageBase64 = match[2];

    const apiKey = await anthropicApiKey();
    if (!apiKey) {
      console.error("recognize-book-cover: ANTHROPIC_API_KEY not configured");
      return json({ error: "מפתח שירות הזיהוי אינו מוגדר." }, 500);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: imageBase64 },
              },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      console.error("Anthropic error", response.status, bodyText);
      return json({ error: "שירות הזיהוי החזותי נכשל." }, response.status >= 500 ? 502 : 400);
    }

    const payload = await response.json();
    const textBlock = (payload.content || []).find(
      (block: any) => block?.type === "text",
    );
    if (!textBlock) {
      console.error("No text block in Anthropic response", payload);
      return json({ error: "שירות הזיהוי החזיר תשובה לא תקינה." }, 502);
    }

    let parsed: any;
    try {
      parsed = parseJsonObject(textBlock.text);
    } catch (error) {
      console.error("Could not parse model output", error, textBlock.text);
      return json({ error: "שירות הזיהוי החזיר תשובה לא תקינה." }, 502);
    }

    const candidates = Array.isArray(parsed?.candidates)
      ? parsed.candidates
          .slice(0, 3)
          .map((item: any) => ({
            title: String(item?.title || "").trim(),
            author: String(item?.author || "").trim(),
            language: String(item?.language || "").trim(),
            confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
            reason: String(item?.reason || "").trim(),
          }))
          .filter((item: any) => item.title)
      : [];

    return json({ candidates });
  } catch (error) {
    console.error("recognize-book-cover failed", error);
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "הזיהוי ארך זמן רב מדי. נסה שוב."
        : "לא ניתן לזהות את הכריכה כרגע.";
    return json({ error: message }, 500);
  }
});
