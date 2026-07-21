const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const root = path.resolve(__dirname, "..");
const wait = () => new Promise((resolve) => setTimeout(resolve, 15));

test("main workflow loads, edits, favorites, acquires and trashes without console errors", async () => {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  virtualConsole.on("error", (error) => errors.push(error));
  const dom = new JSDOM(
    fs.readFileSync(path.join(root, "index.html"), "utf8"),
    {
      url: "https://example.test/",
      runScripts: "outside-only",
      virtualConsole,
    },
  );
  const { window } = dom;
  const remoteBooks = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
      title: "ספר בדיקה",
      author: "מחבר",
      cover: "data:image/jpeg;base64,QQ==",
      notes: "",
      status: "מחפש",
      priority: "רגילה",
      is_favorite: false,
      is_required: false,
      isbn: "9780306406157",
      acquired_at: null,
      purchase_price: null,
      new_price: 90,
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
    },
  ];
  const missingUpgrade = {
    code: "PGRST204",
    message: "column is missing from the schema cache",
  };

  class Query {
    constructor() {
      this.patch = null;
    }
    select() {
      return this;
    }
    order() {
      return Promise.resolve({ data: remoteBooks, error: null });
    }
    upsert(row) {
      const rows = Array.isArray(row) ? row : [row];
      if (rows.some((item) => Object.hasOwn(item, "priority")))
        return Promise.resolve({ error: missingUpgrade });
      for (const item of rows) {
        const index = remoteBooks.findIndex((book) => book.id === item.id);
        if (index >= 0) remoteBooks[index] = { ...remoteBooks[index], ...item };
        else remoteBooks.push(item);
      }
      return Promise.resolve({ error: null });
    }
    update(patch) {
      this.patch = patch;
      return this;
    }
    eq(column, value) {
      if (this.patch) {
        if (Object.hasOwn(this.patch, "acquired_at"))
          return Promise.resolve({ error: missingUpgrade });
        const book = remoteBooks.find((item) => item[column] === value);
        if (book) Object.assign(book, this.patch);
      }
      return Promise.resolve({ error: null });
    }
  }

  const mockDb = {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: {
            session: {
              user: { id: remoteBooks[0].user_id, email: "user@example.test" },
            },
          },
        }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
      signInWithPassword: () => Promise.resolve({ error: null }),
      signUp: () => Promise.resolve({ data: { session: null }, error: null }),
      signOut: () => Promise.resolve(),
    },
    from: () => new Query(),
  };
  window.HamadafSupabase = { createClient: () => mockDb };
  window.confirm = () => true;
  window.alert = () => {};
  window.scrollTo = () => {};
  window.eval(fs.readFileSync(path.join(root, "app.js"), "utf8"));
  await wait();
  await wait();

  assert.equal(
    window.document.getElementById("authModal").classList.contains("open"),
    false,
  );
  assert.match(
    window.document.getElementById("books").textContent,
    /ספר בדיקה/,
  );
  assert.equal(
    window.document.querySelector(".book img").getAttribute("src"),
    "data:image/jpeg;base64,QQ==",
  );

  window.document.querySelector(".book").click();
  window.document.getElementById("edit").click();
  window.document.getElementById("author").value = "מחבר מעודכן";
  window.document.getElementById("priority").value = "דחופה";
  window.document.getElementById("save").click();
  await wait();
  assert.match(
    window.document.getElementById("books").textContent,
    /מחבר מעודכן/,
  );
  assert.ok(window.document.querySelector(".book.priority-urgent"));

  window.document.querySelector(".favoriteToggle").click();
  await wait();
  assert.equal(remoteBooks[0].is_favorite, true);

  window.document.querySelector(".book").click();
  window.document.querySelector('[data-move="השגתי"]').click();
  await wait();
  assert.equal(remoteBooks[0].status, "השגתי");
  assert.equal(remoteBooks[0].acquired_at, null);
  assert.match(
    window.document.getElementById("toast").textContent,
    /המיגרציות/,
  );

  window.document.querySelector('[data-status="השגתי"]').click();
  window.document.querySelector(".book").click();
  window.document.querySelector('[data-move="סל מחזור"]').click();
  await wait();
  assert.equal(remoteBooks[0].status, "סל מחזור");
  assert.deepEqual(errors, []);
});
