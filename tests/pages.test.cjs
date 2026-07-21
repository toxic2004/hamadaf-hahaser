const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const pages = fs.readdirSync(root).filter((name) => name.endsWith(".html"));

test("all pages are Hebrew RTL, responsive, and have unique IDs", () => {
  for (const page of pages) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, page), "utf8"));
    const document = dom.window.document;
    assert.equal(document.documentElement.lang, "he", page);
    assert.equal(document.documentElement.dir, "rtl", page);
    assert.ok(document.querySelector('meta[name="viewport"]'), page);
    const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
    assert.equal(new Set(ids).size, ids.length, `${page} has duplicate IDs`);
  }
});

test("mobile layout protects iPhone safe areas and narrow screens", () => {
  const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const dashboard = fs.readFileSync(
    path.join(root, "dashboard.css"),
    "utf8",
  );
  const isbn = fs.readFileSync(path.join(root, "isbn.html"), "utf8");

  for (const source of [styles, dashboard, isbn]) {
    assert.match(source, /safe-area-inset-bottom/);
    assert.match(source, /100dvh/);
  }
  assert.match(styles, /\.tools \.search\s*{[^}]*grid-column:\s*1 \/ -1/s);
  assert.match(styles, /@media \(max-width: 350px\)/);
  assert.match(dashboard, /overflow-x:\s*hidden/);
});

test("all local navigation and asset targets exist", () => {
  for (const page of pages) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, page), "utf8"));
    for (const node of dom.window.document.querySelectorAll(
      "[href],script[src],link[href]",
    )) {
      const target = node.getAttribute("href") || node.getAttribute("src");
      if (!target || /^(https?:|data:|#)/.test(target)) continue;
      const clean = target.split("?")[0].split("#")[0];
      const resolved =
        clean === "./"
          ? path.join(root, "index.html")
          : path.resolve(root, clean);
      assert.ok(fs.existsSync(resolved), `${page}: missing ${target}`);
    }
  }
});

test("critical UI flows are wired and ISBN has a back link", () => {
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  for (const id of [
    "signIn",
    "save",
    "add",
    "exportExcel",
    "priority",
    "isFavorite",
    "isRequired",
  ]) {
    assert.match(index, new RegExp(`id=["']${id}["']`));
    assert.match(app, new RegExp(`\\b${id}\\b`));
  }
  const isbn = new JSDOM(fs.readFileSync(path.join(root, "isbn.html"), "utf8"))
    .window.document;
  assert.ok(isbn.querySelector('a[href="./"]'));
  assert.ok(isbn.getElementById("scanIsbn"));
  assert.ok(isbn.getElementById("isbnScanner"));
  assert.ok(isbn.getElementById("isbnVideo"));
  assert.ok(isbn.querySelector('script[src="isbn-scanner.js"]'));
  const scanner = fs.readFileSync(path.join(root, "isbn-scanner.js"), "utf8");
  assert.match(scanner, /decodeFromConstraints/);
  assert.match(scanner, /facingMode/);
  assert.match(scanner, /lookupBook/);
  const coverModule = fs.readFileSync(
    path.join(root, "cover-recognition.js"),
    "utf8",
  );
  assert.match(coverModule, /id="coverImage"/);
  assert.match(coverModule, /accept="image\/\*"/);
  assert.match(coverModule, /capture="environment"/);
});

test("dashboard controls have concrete handlers", () => {
  const expectations = {
    "statistics.js": ["login", "period", "print"],
    "prices.js": [
      "login",
      "bookSelect",
      "shippingKnown",
      "saveOffer",
      "resetForm",
    ],
    "price-history.js": ["login", "bookSelect"],
    "notifications.js": ["login", "saveSettings", "markAllRead"],
  };
  for (const [file, ids] of Object.entries(expectations)) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const id of ids) {
      assert.match(
        source,
        new RegExp(`\\$\\(["']${id}["']\\)`),
        `${file}: ${id}`,
      );
    }
  }
  const isbn = fs.readFileSync(path.join(root, "isbn.html"), "utf8");
  for (const id of ["login", "logout", "lookup", "save", "clear"])
    assert.match(isbn, new RegExp(`\\$\\(["']${id}["']\\)\\.onclick`));
  assert.match(isbn, /select\("id,title,notes,status"\)/);
  assert.match(isbn, /delete row\.isbn/);
});
