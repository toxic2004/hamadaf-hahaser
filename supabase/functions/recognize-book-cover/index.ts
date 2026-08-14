import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

function extractOutputText(payload: any): string {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts: string[] = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function parseJsonObject(text: string): any {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

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

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "מפתח שירות הזיהוי אינו מוגדר." }, 500);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-mini",
        store: false,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  "זהה את הספר שבתמונת הכריכה.",
                  "המטרה היא לזהות את זהות הספר, לא לתמלל את כל הטקסט.",
                  "התעלם מהמלצות, ציטוטים, מדבקות מחיר, שם ההוצאה וטקסט שיווקי.",
                  "החזר JSON בלבד ובדיוק במבנה הבא:",
                  '{"candidates":[{"title":"שם הספר","author":"שם המחבר","language":"he","confidence":0.0,"reason":"הסבר קצר"}]}',
                  "החזר אפשרות אחת כשאתה בטוח, ועד שלוש אפשרויות במקרה של ספק.",
                  "confidence חייב להיות מספר בין 0 ל-1.",
                  "אל תמציא. אם לא ניתן לזהות, החזר candidates כמערך ריק.",
                ].join("\n"),
              },
              { type: "input_image", image_url: imageDataUrl, detail: "high" },
            ],
          },
        ],
      }),
    });
    clearTimeout(timeout);

    const payload = await openAIResponse.json();
    if (!openAIResponse.ok) {
      console.error("OpenAI error", openAIResponse.status, payload);
      const message = payload?.error?.message || "שירות הזיהוי החזותי נכשל.";
      return json({ error: message }, openAIResponse.status >= 500 ? 502 : 400);
    }

    let parsed: any;
    try {
      parsed = parseJsonObject(extractOutputText(payload));
    } catch (error) {
      console.error("Could not parse model output", error, extractOutputText(payload));
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
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "הזיהוי ארך זמן רב מדי. נסה שוב."
      : "לא ניתן לזהות את הכריכה כרגע.";
    return json({ error: message }, 500);
  }
});
