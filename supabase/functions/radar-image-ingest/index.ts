import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.9";
import { extractOffersFromImage } from "./extraction-core.mjs";

// רדאר המדף - קליטה מתמונה (עדכון ארכיטקטוני, 31.08.2026, ראו
// docs/2026-08-30-radar-hamadaf-spec.md). Scope of THIS function only:
// take an image, return structured candidate offers. It does NOT write
// to manual_offers and does NOT touch books beyond a read-only select -
// saving happens from a separate, later step once the user reviews and
// confirms in the UI. Does not touch report_checks/report_runs/
// price_offers/alerts in any way.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB, comfortably under Claude's image limits

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const ALLOWED_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }
  try {
    // Real end-user auth (this is invoked from the browser by the
    // logged-in user, not by pg_cron with a shared secret) - same
    // pattern as processOfferMode in supabase/functions/alerts/index.ts.
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!SUPABASE_URL || !ANON_KEY) {
      throw new Error("Missing required Supabase authentication configuration");
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { authorization } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } =
      await userClient.auth.getUser();
    if (authError || !authData.user)
      return json({ error: "unauthorized" }, 401);
    const userId = authData.user.id;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid request body" }, 400);
    }
    const imageBase64 =
      typeof body.image_base64 === "string" ? body.image_base64 : "";
    const mediaType =
      typeof body.media_type === "string" ? body.media_type : "";
    if (!imageBase64) return json({ error: "image_base64 is required" }, 400);
    if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
      return json({ error: "unsupported media_type" }, 400);
    }
    // Rough size guard on the base64 payload itself (base64 is ~4/3 the
    // size of the decoded bytes) - reject oversized uploads before ever
    // reaching the Anthropic API.
    if (imageBase64.length > (MAX_IMAGE_BYTES * 4) / 3) {
      return json({ error: "image too large" }, 400);
    }

    // Read-only, scoped to this user, status='מחפש' only - identical
    // scope rule as everywhere else in radar hamadaf. Never writes to
    // books from this function.
    const { data: books, error: booksError } = await service()
      .from("books")
      .select("id,title,author")
      .eq("user_id", userId)
      .eq("status", "מחפש");
    if (booksError) throw booksError;

    const apiKey = await anthropicApiKey();
    if (!apiKey) {
      return json({ error: "ANTHROPIC_API_KEY not configured" }, 503);
    }

    const result = await extractOffersFromImage({
      apiKey,
      imageBase64,
      mediaType,
      books: books || [],
    });

    return json({ ok: true, ...result });
  } catch (error) {
    console.error("radar-image-ingest: request failed", error);
    return json({ error: "internal error" }, 500);
  }
});
