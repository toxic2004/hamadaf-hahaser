// render-server: a small standalone service that renders a URL with a
// real headless browser and returns the fully-loaded HTML. Exists because
// Supabase Edge Functions cannot run a headless browser at all (confirmed
// against Supabase's own documentation, 2026-08-16: "Edge Functions cannot
// run a Headless Browser instance due to resource constraints") - this is
// a hard platform limitation, not a workaround for anything. Evrit
// (e-vrit.co.il)'s search-results page ships no product data at all in
// its initial HTML response (confirmed live, 2026-08-16: a raw fetch
// returns a Next.js RSC/hydration payload with zero "/product/" links
// anywhere in it) - the real results only exist after client-side
// JavaScript runs. This server runs that JavaScript so the Edge Function
// can keep doing what it already does (a plain HTTP GET), just against
// this server's /render endpoint instead of the source site directly for
// sources that need it.
//
// This does NOT bypass any CAPTCHA, login wall, or anti-bot check - it
// only executes the same JavaScript a real visitor's browser would run to
// see the page's own content.

import express from "express";
import { chromium } from "playwright";

const app = express();
const PORT = process.env.PORT || 3000;
const SHARED_SECRET = process.env.RENDER_SHARED_SECRET || "";
const NAV_TIMEOUT_MS = 20_000;
const MAX_HTML_BYTES = 4_000_000;

if (!SHARED_SECRET) {
  console.warn(
    "WARNING: RENDER_SHARED_SECRET is not set. Every request will be rejected until it is configured.",
  );
}

function isAllowedTarget(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "only https URLs are allowed" };
  }
  // Defensive allowlist (2026-08-16): this server should only ever be
  // asked to render the specific book-source sites this project scans -
  // never an arbitrary URL. Add a hostname here only after confirming
  // with the user that a new source genuinely needs JS rendering (the
  // same bar as any other source integration in this project).
  const ALLOWED_HOSTNAMES = new Set([
    "e-vrit.co.il",
    "www.e-vrit.co.il",
  ]);
  if (!ALLOWED_HOSTNAMES.has(url.hostname)) {
    return { ok: false, reason: `hostname not allowlisted: ${url.hostname}` };
  }
  return { ok: true, url };
}

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/render", async (req, res) => {
  const providedSecret = req.header("x-render-secret") || "";
  if (!SHARED_SECRET || providedSecret !== SHARED_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
  if (!rawUrl) {
    return res.status(400).json({ error: "missing url query parameter" });
  }
  const allowed = isAllowedTarget(rawUrl);
  if (!allowed.ok) {
    return res.status(400).json({ error: allowed.reason });
  }

  let browser;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      locale: "he-IL",
    });
    const page = await context.newPage();
    await page.goto(allowed.url.toString(), {
      waitUntil: "networkidle",
      timeout: NAV_TIMEOUT_MS,
    });
    const html = await page.content();
    if (html.length > MAX_HTML_BYTES) {
      return res.status(502).json({ error: "rendered page too large" });
    }
    return res.status(200).json({ ok: true, html });
  } catch (error) {
    console.error("render failed", rawUrl, error);
    return res.status(502).json({
      error: "render failed",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Already closed or failed to launch - nothing to clean up.
      }
    }
  }
});

app.listen(PORT, () => {
  console.log(`render-server listening on port ${PORT}`);
});
