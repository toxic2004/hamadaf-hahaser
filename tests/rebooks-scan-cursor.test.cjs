const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

function scanner() {
  return import(
    path.join(__dirname, "..", "supabase/functions/alerts/scanner-core.mjs")
  );
}

test("nextCursorAfterBatch: full batch returns the last book's id, so the next call continues after it", async () => {
  const { nextCursorAfterBatch } = await scanner();
  const batch = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(nextCursorAfterBatch(batch, 3), "c");
});

test("nextCursorAfterBatch: partial batch (reached the end of the list) wraps to the start", async () => {
  const { nextCursorAfterBatch } = await scanner();
  const batch = [{ id: "x" }, { id: "y" }];
  assert.equal(nextCursorAfterBatch(batch, 5), null);
});

test("nextCursorAfterBatch: empty batch (cursor was past the last book, or no books at all) wraps to the start", async () => {
  const { nextCursorAfterBatch } = await scanner();
  assert.equal(nextCursorAfterBatch([], 5), null);
});

test("nextCursorAfterBatch: exact-limit batch that also happens to be everything still advances forward (not falsely treated as reaching the end) - the *next* call naturally gets an empty batch and wraps then", async () => {
  const { nextCursorAfterBatch } = await scanner();
  // 3 books total, limit is exactly 3 - this looks identical to "more
  // books exist after this batch" from the function's own inputs alone,
  // and that's fine: the very next scan simply gets 0 books back and
  // wraps at that point instead. No book is ever skipped either way.
  const batch = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(nextCursorAfterBatch(batch, 3), "c");
});

test("regression: simulates 7 books with a batch limit of 3 across repeated calls - every book gets visited exactly once per full cycle, not just the first 3 forever", async () => {
  const { nextCursorAfterBatch } = await scanner();
  const allBooks = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id }));
  const limit = 3;
  const visited = [];
  let cursor = null;
  for (let call = 0; call < 4; call++) {
    const batch = allBooks
      .filter((book) => cursor === null || book.id > cursor)
      .slice(0, limit);
    visited.push(...batch.map((book) => book.id));
    cursor = nextCursorAfterBatch(batch, limit);
  }
  // First full cycle (7 books / 3 per call = 3 calls) visits every book
  // once, then the 4th call wraps back to the start - proving the old
  // bug (always re-scanning books a/b/c forever) is actually fixed.
  assert.deepEqual(visited.slice(0, 7).sort(), [
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
  ]);
  assert.deepEqual(visited.slice(7), ["a", "b", "c"]);
});
