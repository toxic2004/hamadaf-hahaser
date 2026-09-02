const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const signatureKey = "hamadaf-local-import-signature-v1";

function loadModule() {
  const dom = new JSDOM("<!doctype html><body></body>", {
    runScripts: "outside-only",
    url: "https://example.test/",
  });
  dom.window.eval(fs.readFileSync(path.join(root, "manual-import.js"), "utf8"));
  return { dom, api: dom.window.HamadafManualImport };
}

function makeDb(result) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, "books");
      return {
        upsert(rows) {
          calls.push(rows);
          return Promise.resolve(result);
        },
      };
    },
  };
}

function book(title, author = "", isbn = "") {
  return {
    id: title + author + isbn,
    title,
    author,
    isbn,
    created: Date.now(),
    status: "מחפש",
  };
}

function startPrompt(options) {
  return options.api.promptAndImport({
    document: options.dom.window.document,
    db: options.db,
    user: options.user,
    localBooks: options.localBooks,
    remoteBooks: options.remoteBooks,
    bookToRow: (item) => ({ ...item, user_id: options.user.id }),
    onImported: options.onImported,
  });
}

test("empty cloud requires explicit confirmation before importing", async () => {
  const { dom, api } = loadModule();
  const db = makeDb({ error: null });
  const localBooks = [book("ספר מקומי")];
  let imported = [];
  const pending = startPrompt({
    dom,
    api,
    db,
    user: { id: "user-1" },
    localBooks,
    remoteBooks: [],
    onImported: (books) => {
      imported = books;
    },
  });

  assert.equal(db.calls.length, 0);
  dom.window.document.getElementById("confirmLocalImport").click();
  const result = await pending;
  assert.equal(result.status, "completed");
  assert.equal(db.calls.length, 1);
  assert.equal(imported.length, 1);
  assert.equal(
    dom.window.localStorage.getItem(signatureKey),
    api.listSignature(localBooks),
  );
});

test("temporary Supabase write failure does not change local display or store signature", async () => {
  const { dom, api } = loadModule();
  const db = makeDb({ error: { message: "temporary network failure" } });
  let changed = false;
  const pending = startPrompt({
    dom,
    api,
    db,
    user: { id: "user-1" },
    localBooks: [book("ספר מקומי")],
    remoteBooks: [],
    onImported: () => {
      changed = true;
    },
  });

  dom.window.document.getElementById("confirmLocalImport").click();
  const result = await pending;
  assert.equal(result.status, "failed");
  assert.equal(changed, false);
  assert.equal(dom.window.localStorage.getItem(signatureKey), null);
  assert.equal(
    dom.window.document
      .getElementById("localImportModal")
      .classList.contains("open"),
    true,
  );
});

test("new signed in user without local data triggers no import", async () => {
  const { dom, api } = loadModule();
  const db = makeDb({ error: null });
  const result = await api.promptAndImport({
    document: dom.window.document,
    db,
    user: { id: "new-user" },
    localBooks: null,
    remoteBooks: [],
    bookToRow: (item) => item,
  });

  assert.equal(result.status, "not-needed");
  assert.equal(db.calls.length, 0);
  assert.equal(dom.window.document.getElementById("localImportModal"), null);
});

test("old local list is parsed and shown for confirmation", () => {
  const { api } = loadModule();
  const parsed = api.parseLocalBooks(
    JSON.stringify([book("ספר מגרסה קודמת"), null, { invalid: true }]),
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, "ספר מגרסה קודמת");
});

test("cancel closes the dialog without writing or storing signature", async () => {
  const { dom, api } = loadModule();
  const db = makeDb({ error: null });
  const pending = startPrompt({
    dom,
    api,
    db,
    user: { id: "user-1" },
    localBooks: [book("ספר מקומי")],
    remoteBooks: [],
  });

  dom.window.document.getElementById("cancelLocalImport").click();
  const result = await pending;
  assert.equal(result.status, "cancelled");
  assert.equal(db.calls.length, 0);
  assert.equal(dom.window.localStorage.getItem(signatureKey), null);
  assert.equal(
    dom.window.document
      .getElementById("localImportModal")
      .classList.contains("open"),
    false,
  );
});

test("duplicates are excluded and only new books are written", async () => {
  const { dom, api } = loadModule();
  const db = makeDb({ error: null });
  const localBooks = [
    book("ספר זהה", "מחבר", "978-1-234"),
    book("  ספר   זהה  ", "מחבר"),
    book("ספר חדש", "מחבר חדש"),
    book("ספר חדש", "מחבר חדש"),
  ];
  const remoteBooks = [book("עותק בענן", "מחבר אחר", "9781234")];
  const pending = startPrompt({
    dom,
    api,
    db,
    user: { id: "user-1" },
    localBooks,
    remoteBooks,
  });

  const summary =
    dom.window.document.getElementById("localImportSummary").textContent;
  assert.match(summary, /4/);
  assert.match(summary, /2/);
  dom.window.document.getElementById("confirmLocalImport").click();
  const result = await pending;
  assert.equal(result.analysis.duplicateCount, 2);
  assert.equal(result.analysis.newCount, 2);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].length, 2);
});

test("no new books: signature is stored immediately, without ever showing the modal (closes the reappearing-dialog bug)", async () => {
  const { dom, api } = loadModule();
  const db = makeDb({ error: null });
  const localBooks = [book("ספר קיים", "מחבר")];
  const result = await startPrompt({
    dom,
    api,
    db,
    user: { id: "user-1" },
    localBooks,
    remoteBooks: [book("ספר קיים", "מחבר")],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.imported, 0);
  assert.equal(db.calls.length, 0);
  assert.equal(dom.window.document.getElementById("localImportModal"), null);
  assert.equal(
    dom.window.localStorage.getItem(signatureKey),
    api.listSignature(localBooks),
  );
});

test("same reviewed local list does not reopen import dialog", async () => {
  const { dom, api } = loadModule();
  const db = makeDb({ error: null });
  const localBooks = [book("ספר קיים", "מחבר")];
  dom.window.localStorage.setItem(signatureKey, api.listSignature(localBooks));

  const result = await startPrompt({
    dom,
    api,
    db,
    user: { id: "user-1" },
    localBooks,
    remoteBooks: [book("ספר קיים", "מחבר")],
  });

  assert.equal(result.status, "not-needed");
  assert.equal(result.reason, "already-reviewed");
  assert.equal(db.calls.length, 0);
  assert.equal(dom.window.document.getElementById("localImportModal"), null);
});

test("changed local list receives a new review even when an older signature exists", async () => {
  const { dom, api } = loadModule();
  const db = makeDb({ error: null });
  const oldBooks = [book("ספר ישן", "מחבר")];
  const changedBooks = [book("ספר ישן", "מחבר"), book("ספר חדש", "מחבר אחר")];
  dom.window.localStorage.setItem(signatureKey, api.listSignature(oldBooks));

  const pending = startPrompt({
    dom,
    api,
    db,
    user: { id: "user-1" },
    localBooks: changedBooks,
    remoteBooks: [book("ספר ישן", "מחבר")],
  });

  assert.ok(dom.window.document.getElementById("localImportModal"));
  dom.window.document.getElementById("cancelLocalImport").click();
  const result = await pending;
  assert.equal(result.status, "cancelled");
});
