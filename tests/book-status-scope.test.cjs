const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Regression guard for a specific requirement from the user:
// the daily report must scan every book whose status is "מחפש" or
// "בדיונים" (i.e. every status except "השגתי" and "סל מחזור").
//
// The current SQL implements this correctly as an EXCLUSION filter
// (status not in ('השגתי', 'סל מחזור')), which automatically covers
// "בדיונים" without needing to name it. The risk this test guards
// against is someone later "simplifying" this to a WHITELIST such as
// status = 'מחפש', which would silently stop scanning books in
// "בדיונים" without anyone noticing (no error, just fewer books
// scanned). This test fails loudly if that ever happens.

const MIGRATIONS_DIR = path.resolve(__dirname, "../supabase/migrations");
const REQUIRED_EXCLUSION = /status\s+not\s+in\s*\(\s*'השגתי'\s*,\s*'סל מחזור'\s*\)/;
const SUSPICIOUS_WHITELIST =
  /\bstatus\s*=\s*'(?:מחפש|בדיונים)'|\bstatus\s+in\s*\(\s*'(?:מחפש|בדיונים)'/;

function sqlFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => path.join(MIGRATIONS_DIR, name));
}

test("book scan scope excludes only השגתי/סל מחזור, so בדיונים is always included", () => {
  const files = sqlFiles();
  const filesThatScopeBooks = files.filter((file) => {
    const sql = fs.readFileSync(file, "utf8");
    return /report_checks|sync_report_run_scope/i.test(sql) && /books/i.test(sql);
  });

  assert.ok(
    filesThatScopeBooks.length > 0,
    "expected at least one migration that scopes books into report_checks",
  );

  for (const file of filesThatScopeBooks) {
    const sql = fs.readFileSync(file, "utf8");
    // Every "books.status" scoping condition found in this file must use
    // the exclusion pattern, not a narrower whitelist.
    // Matches both "books.status not in (...)" and the bare
    // "status not in (...)" form used inside "from public.books where ...".
    // Restricted to conditions that mention השגתי/סל מחזור so we don't
    // pick up unrelated report_checks.status filters (pending/temporary_error).
    const statusConditions =
      sql.match(/(?:books\.)?status\s+not\s+in\s*\('(?:השגתי|סל מחזור)'[^)]*\)/gi) || [];
    for (const condition of statusConditions) {
      if (/not\s+in/i.test(condition)) {
        assert.match(
          condition,
          REQUIRED_EXCLUSION,
          `${path.basename(file)}: status exclusion must be exactly ('השגתי', 'סל מחזור') so בדיונים stays included: "${condition}"`,
        );
      }
    }
  }
});

test("no migration introduces a status whitelist that would drop בדיונים from scanning", () => {
  for (const file of sqlFiles()) {
    const sql = fs.readFileSync(file, "utf8");
    // Only check lines that are actually about scoping books for scanning,
    // not unrelated status columns (e.g. report run status, check status).
    const lines = sql.split("\n").filter((line) => /books\.status|books\s+\w*\s*where.*status/i.test(line));
    for (const line of lines) {
      assert.doesNotMatch(
        line,
        SUSPICIOUS_WHITELIST,
        `Found a books-status whitelist instead of the required exclusion filter, which would silently drop "בדיונים" books from scanning: "${line.trim()}"`,
      );
    }
  }
});
