import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.9";
import {
  buildPriceOfferPayload,
  nextCursorAfterBatch,
  scanBookOnBooknet,
  scanBookOnEvrit,
  scanBookOnFindabook,
  scanBookOnRebooks,
  scanBookOnSteimatzky,
} from "./scanner-core.mjs";

// Simple multi-source scanner (2026-08-19, Rebooks only; extended
// 2026-08-31 to all 4 sources per the user's explicit go-ahead).
// Deliberately separate from supabase/functions/alerts - does NOT read
// or write report_checks/report_runs at all. One book in, one
// verified-or-nothing price_offers row out per source, per the user's
// own description of what he wants ("פעולה פשוטה ואמיתית", section 3).
//
// Scope: all 4 sources from section 4 of the spec, checked in the
// documented order (Rebooks first, then the others). yad2/Facebook
// stay unautomated per section 4 (login required) - not attempted here.
//
// Never touches the `books` table beyond a read-only select.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Politeness: a short pause once per book, after all 5 sources have
// been checked for it - not between each individual source call within
// the same book, since consecutive calls there go to different domains
// (no risk of hammering any single site rapidly). Not an attempt to
// defeat any block - if a source blocks a request anyway, the correct
// response is to report "not verified", never to escalate toward
// fingerprinting or paid unblocking.
const REQUEST_DELAY_MS = 500;
const FETCH_TIMEOUT_MS = 6_000;
// Lowered from 15 (2026-08-31): scanning 5 sources per book instead of
// 1 means up to ~9 fetches per book now (Evrit and Steimatzky each need
// a second product-page fetch), not 1-3. This is a conservative
// estimate, not yet confirmed against real invocation timing - the
// premortem checklist item "ריצת אימות חי מקצה לקצה" still applies
// before this actually gets scheduled on a cron.
const DEFAULT_BOOK_LIMIT = 5;
const MAX_BOOK_LIMIT = 10;

const SOURCE_SCANNERS = [
  { id: "rebooks", scan: scanBookOnRebooks },
  { id: "evrit", scan: scanBookOnEvrit },
  { id: "booknet", scan: scanBookOnBooknet },
  { id: "steimatzky", scan: scanBookOnSteimatzky },
  { id: "findabook", scan: scanBookOnFindabook },
] as const;

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Loads books directly from the single source of truth, exactly the
// statuses the user specified (section 2) - nothing else, no separate
// watch-list, no mutation.
//
// Keyset-pagination cursor (2026-08-31): previously always
// .order("id").limit(N) with no cursor, so repeated invocations only
// ever re-scanned the same first N books and never reached the rest of
// a 67-75 book list. book.id is a text UUID, not chronological, but
// text comparison is still a stable total order - exactly what keyset
// pagination needs to guarantee every book is visited once per cycle.
async function loadActiveBooks(
  userId: string,
  limit: number,
  cursor: string | null,
) {
  let query = service()
    .from("books")
    .select("id,user_id,title,author,status")
    .eq("user_id", userId)
    .in("status", ["מחפש", "בדיונים"])
    .order("id", { ascending: true })
    .limit(limit);
  if (cursor) query = query.gt("id", cursor);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function getScanCursor(userId: string): Promise<string | null> {
  const { data, error } = await service()
    .from("rebooks_scan_cursor")
    .select("last_book_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.last_book_id || null;
}

async function setScanCursor(userId: string, lastBookId: string | null) {
  const { error } = await service().from("rebooks_scan_cursor").upsert({
    user_id: userId,
    last_book_id: lastBookId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// Same select-then-insert/update pattern already used in alerts/index.ts,
// keyed by (user_id, source, source_listing_key) - identifies an offer by
// its source and product id, never by free-text title, so a re-check of
// the same listing updates the existing row instead of creating a
// duplicate (section 7).
async function saveOffer(
  book: Record<string, any>,
  offer: Record<string, any>,
) {
  const existing = await service()
    .from("price_offers")
    .select("id")
    .eq("user_id", book.user_id)
    .eq("source", offer.source)
    .eq("source_listing_key", offer.sourceListingKey)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const payload = buildPriceOfferPayload(book, offer, new Date());
  const saved = existing.data?.id
    ? await service()
        .from("price_offers")
        .update(payload)
        .eq("id", existing.data.id)
        .eq("user_id", book.user_id)
    : await service().from("price_offers").insert(payload);
  if (saved.error) throw saved.error;
  return { created: !existing.data?.id };
}

// Never store an offer we can't actually stand behind: needs a direct
// product page (already enforced per-source in extractSourceOffers/
// the relevant extract* function), a real price, and an explicit
// availability status (section 3 - "אם אחד מהפרטים אינו ידוע, אסור
// להמציא אותו"). Applied uniformly across every source, not just
// Rebooks - the rule doesn't change per site.
function isSaveableOffer(offer: Record<string, any>): boolean {
  return (
    offer.itemPrice != null &&
    Boolean(offer.sourceUrl) &&
    (offer.availabilityStatus === "במלאי" ||
      offer.availabilityStatus === "לא במלאי")
  );
}

async function scanUser(userId: string, limit: number) {
  const cursor = await getScanCursor(userId);
  const books = await loadActiveBooks(userId, limit, cursor);
  const summary = {
    booksScanned: 0,
    offersFound: 0,
    offersSaved: 0,
    cursorBefore: cursor,
    cursorAfter: null as string | null,
    perBook: [] as Array<Record<string, unknown>>,
  };
  for (const book of books) {
    summary.booksScanned += 1;
    let foundForBook = 0;
    let savedForBook = 0;
    const perSource: Record<string, unknown> = {};
    for (const { id: sourceId, scan } of SOURCE_SCANNERS) {
      let result: Awaited<ReturnType<typeof scanBookOnRebooks>>;
      try {
        result = await scan(book, {
          fetchImpl: fetch,
          timeoutMs: FETCH_TIMEOUT_MS,
        });
      } catch (error) {
        result = {
          status: "temporary_error",
          note: String((error as Error)?.message || error),
          offers: [],
        };
      }
      let savedForSource = 0;
      for (const offer of result.offers) {
        if (!isSaveableOffer(offer)) continue;
        await saveOffer(book, offer);
        savedForSource += 1;
        summary.offersSaved += 1;
      }
      foundForBook += result.offers.length;
      savedForBook += savedForSource;
      perSource[sourceId] = {
        status: result.status,
        offersFound: result.offers.length,
        offersSaved: savedForSource,
      };
    }
    summary.offersFound += foundForBook;
    summary.perBook.push({
      bookId: book.id,
      title: book.title,
      offersFound: foundForBook,
      offersSaved: savedForBook,
      sources: perSource,
    });
    await sleep(REQUEST_DELAY_MS);
  }
  const newCursor = nextCursorAfterBatch(books, limit);
  await setScanCursor(userId, newCursor);
  summary.cursorAfter = newCursor;
  return summary;
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

    let limit = DEFAULT_BOOK_LIMIT;
    try {
      const body = await request.json();
      if (Number.isFinite(body?.limit) && body.limit > 0) {
        limit = Math.min(Math.floor(body.limit), MAX_BOOK_LIMIT);
      }
    } catch {
      // No body / not JSON - use the default limit.
    }

    const { data: rows, error } = await service()
      .from("books")
      .select("user_id");
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
        results.push({ userId, ...(await scanUser(userId, limit)) });
      } catch (error) {
        console.error("rebooks-simple-scan: user scan failed", error);
        results.push({ userId, error: "scan failed" });
      }
    }
    return json({ ok: true, limit, users: users.length, results });
  } catch (error) {
    console.error("rebooks-simple-scan: request failed", error);
    return json({ error: "internal error" }, 500);
  }
});
