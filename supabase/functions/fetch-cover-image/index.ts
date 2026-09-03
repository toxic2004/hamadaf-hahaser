import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Proxies fetching an arbitrary cover-image URL server-side, because
// browsers block cross-origin image fetches (CORS) for the vast
// majority of third-party sites hosting book covers - the client-side
// fetch(src, {mode:"cors"}) in app.js's importCover() was silently
// failing on almost every image a person picked from Google Image
// Search results. Server-to-server has no CORS restriction, so this
// sidesteps the problem entirely. verify_jwt=true (project setting)
// keeps this from being an open image-fetching proxy for the internet.

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

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { url } = await req.json();
    if (typeof url !== "string" || !url) {
      return json({ error: "url is required" }, 400);
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return json({ error: "invalid url" }, 400);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return json({ error: "unsupported protocol" }, 400);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; HamadafCoverProxy/1.0; +https://toxic2004.github.io/hamadaf-hahaser/)",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return json({ error: "source returned " + response.status }, 502);
    }

    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim();
    if (!ALLOWED_TYPES.includes(contentType)) {
      return json({ error: "unsupported content-type: " + (contentType || "unknown") }, 415);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_BYTES) {
      return json({ error: "image too large" }, 413);
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      return json({ error: "image too large" }, 413);
    }

    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);

    return json({ dataUrl: `data:${contentType};base64,${base64}` });
  } catch (error) {
    console.error("fetch-cover-image failed", error);
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "התמונה ארכה זמן רב מדי להורדה"
        : "לא ניתן להוריד את התמונה";
    return json({ error: message }, 500);
  }
});
