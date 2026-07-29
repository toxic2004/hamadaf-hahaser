const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadOperations() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "cover-storage-ops.js"),
    "utf8",
  );
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.globalThis.HamadafCoverStorageOps;
}

function createDatabase(options = {}) {
  const calls = [];
  const db = {
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            calls.push({ type: "remove", bucket, paths });
            return { error: options.removeError || null };
          },
        };
      },
    },
    from(table) {
      return {
        delete() {
          return {
            eq(column, value) {
              calls.push({ type: "delete-eq", table, column, value });
              return {
                eq(secondColumn, secondValue) {
                  calls.push({
                    type: "delete-eq",
                    table,
                    column: secondColumn,
                    value: secondValue,
                  });
                  return Promise.resolve({ error: options.deleteError || null });
                },
              };
            },
          };
        },
        async upsert(row) {
          calls.push({ type: "upsert", table, row });
          return { error: options.restoreError || null };
        },
      };
    },
  };
  return { db, calls };
}

test("removes a referenced cover after deleting its book", async () => {
  const operations = loadOperations();
  const { db, calls } = createDatabase();
  const book = { id: "book-1", coverPath: "user/book-1/cover.jpg" };

  const result = await operations.deleteBookWithCover({
    db,
    bucket: "book-covers",
    book,
    userId: "user-1",
    bookToRow: (value) => value,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.deletedCover, true);
  const removeCall = calls.at(-1);
  assert.equal(removeCall.type, "remove");
  assert.equal(removeCall.bucket, "book-covers");
  assert.equal(removeCall.paths.length, 1);
  assert.equal(removeCall.paths[0], "user/book-1/cover.jpg");
});

test("does not touch storage when deleting the database row fails", async () => {
  const operations = loadOperations();
  const { db, calls } = createDatabase({ deleteError: new Error("db") });

  const result = await operations.deleteBookWithCover({
    db,
    bucket: "book-covers",
    book: { id: "book-1", coverPath: "cover.jpg" },
    userId: "user-1",
    bookToRow: (value) => value,
  });

  assert.equal(result.status, "delete-failed");
  assert.equal(calls.some((call) => call.type === "remove"), false);
});

test("restores the book when cover deletion fails", async () => {
  const operations = loadOperations();
  const { db, calls } = createDatabase({ removeError: new Error("storage") });
  const book = { id: "book-1", coverPath: "cover.jpg", title: "ספר" };

  const result = await operations.deleteBookWithCover({
    db,
    bucket: "book-covers",
    book,
    userId: "user-1",
    bookToRow: (value) => ({ ...value, restored: true }),
  });

  assert.equal(result.status, "cleanup-failed-restored");
  assert.deepEqual(calls.at(-1), {
    type: "upsert",
    table: "books",
    row: { ...book, restored: true },
  });
});

test("reports a rollback failure without hiding it", async () => {
  const operations = loadOperations();
  const { db } = createDatabase({
    removeError: new Error("storage"),
    restoreError: new Error("restore"),
  });

  const result = await operations.deleteBookWithCover({
    db,
    bucket: "book-covers",
    book: { id: "book-1", coverPath: "cover.jpg" },
    userId: "user-1",
    bookToRow: (value) => value,
  });

  assert.equal(result.status, "rollback-failed");
  assert.equal(result.cleanupError.message, "storage");
  assert.equal(result.restoreError.message, "restore");
});

test("skips storage deletion when a book has no cover path", async () => {
  const operations = loadOperations();
  const { db, calls } = createDatabase();

  const result = await operations.deleteBookWithCover({
    db,
    bucket: "book-covers",
    book: { id: "book-1", coverPath: "" },
    userId: "user-1",
    bookToRow: (value) => value,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.deletedCover, false);
  assert.equal(calls.some((call) => call.type === "remove"), false);
});
