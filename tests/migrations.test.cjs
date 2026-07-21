const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("new migrations are additive and contain no secrets", () => {
  const directory = path.resolve(__dirname, "../supabase");
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".sql"));
  for (const file of files) {
    const sql = fs.readFileSync(path.join(directory, file), "utf8");
    assert.doesNotMatch(sql, /drop\s+(table|column)\b/i, file);
    assert.doesNotMatch(sql, /delete\s+from\b/i, file);
    assert.doesNotMatch(
      sql,
      /service_role.*[=:]\s*['"][A-Za-z0-9_-]{20,}/i,
      file,
    );
  }
});

test("price data tables enforce per-user RLS and daily deduplication", () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, "../supabase/005_prices_history_notifications.sql"),
    "utf8",
  );
  for (const table of [
    "price_offers",
    "price_history",
    "daily_book_prices",
    "notifications",
    "notification_settings",
    "price_scan_runs",
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(sql, /unique \(offer_id, captured_on\)/i);
  assert.match(sql, /unique \(book_id, captured_on\)/i);
  assert.match(sql, /unique \(user_id, dedupe_key\)/i);
  assert.match(sql, /grant execute on function public\.snapshot_daily_prices\(uuid\) to service_role/i);
});

test("price tables use the existing text book identifier", () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, "../supabase/005_prices_history_notifications.sql"),
    "utf8",
  );
  const textReferences = sql.match(
    /book_id text(?: not null)? references public\.books\(id\)/gi,
  );
  assert.equal(textReferences?.length, 4);
  assert.doesNotMatch(
    sql,
    /book_id uuid(?: not null)? references public\.books\(id\)/i,
  );
});
