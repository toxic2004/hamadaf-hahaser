const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function localAssetsFromHtml(html) {
  const assets = [];
  const pattern =
    /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    const value = match[1].split("?")[0].split("#")[0];
    if (!value || /^(?:https?:|data:|mailto:|tel:|#)/i.test(value)) continue;
    assets.push(value.replace(/^\.\//, ""));
  }
  return assets;
}

test("search covers title, author, ISBN and notes", () => {
  const patch = read("search-patch.js");
  assert.match(patch, /\[b\.title, b\.author, b\.isbn, b\.notes\]/);
  assert.match(read("index.html"), /חיפוש לפי ספר, מחבר או ISBN/);
});

test("duplicate detection covers ISBN, title and author, recycle bin restore and different authors", () => {
  const patch = read("search-patch.js");
  assert.match(patch, /isbnDuplicate/);
  assert.match(patch, /titleAuthorDuplicate/);
  assert.match(patch, /הספר כבר נמצא בסל המחזור/);
  assert.match(patch, /אותו שם אך מחבר שונה/);
  assert.match(patch, /\.eq\("user_id", state\.user\.id\)/);
});

test("display wording consistently uses negotiation while preserving the stored value", () => {
  const index = read("index.html");
  const patch = read("search-patch.js");
  const app = read("app.js");
  assert.match(index, /data-status="בדיונים"[\s\S]*?<span>◌<\/span>משא ומתן/);
  assert.match(app, /בדיונים: "ספרים שנמצאים במשא ומתן"/);
  assert.match(app, /data-move="בדיונים">העבר למשא ומתן/);
  assert.doesNotMatch(patch, /העבר לבדיונים/);
});

test("Supabase browser dependency is pinned exactly", () => {
  for (const file of [
    "index.html",
    "isbn.html",
    "statistics.html",
    "prices.html",
    "notifications.html",
    "price-history.html",
  ]) {
    const html = read(file);
    assert.match(html, /@supabase\/supabase-js@2\.110\.9/);
    assert.doesNotMatch(html, /@supabase\/supabase-js@2(?:["'/])/);
  }
  assert.match(
    read("supabase/functions/alerts/index.ts"),
    /npm:@supabase\/supabase-js@2\.110\.9/,
  );
});

test("the personal app does not expose self registration", () => {
  assert.doesNotMatch(read("index.html"), /id="signUp"|יצירת חשבון/);
  assert.doesNotMatch(read("app.js"), /auth\.signUp|function register/);
});

test("user scoped screens filter reads and mutations by user id", () => {
  const expectations = {
    "prices.js": /\.eq\("user_id", user\.id\)/,
    "notifications.js": /\.eq\("user_id", user\.id\)/,
    "statistics.js": /\.eq\("user_id", user\.id\)/,
    "price-history.js": /\.eq\("user_id", user\.id\)/,
    "cover-recognition.js": /\.eq\("user_id", user\.id\)/,
    "cover-storage.js": /\.eq\("user_id", state\.user\.id\)/,
    "migrate-one-cover.js": /\.eq\("user_id", window\.state\.user\.id\)/,
    "barcode-ean.js": /\.eq\("user_id", user\.id\)/,
    "isbn.html": /\.eq\("user_id", user\.id\)/,
  };
  for (const [file, pattern] of Object.entries(expectations)) {
    assert.match(read(file), pattern, file);
  }
});

test("manual import signature is loaded through a cache-busted loader", () => {
  const index = read("index.html");
  const loader = read("safe-app-loader.js");
  assert.match(
    index,
    /safe-app-loader\.js\?v=quality-cover-cleanup-20260810-1/,
  );
  assert.match(
    loader,
    /manual-import\.js\?v=local-import-signature-20260729-1/,
  );
});

test("ISBN scanner loads pinned ZXing from two CDNs with fallback", () => {
  const scanner = read("isbn-scanner.js");
  assert.match(scanner, /unpkg\.com\/@zxing\/browser@0\.2\.1/);
  assert.match(scanner, /cdn\.jsdelivr\.net\/npm\/@zxing\/browser@0\.2\.1/);
  assert.match(scanner, /for \(const url of ZXING_URLS\)/);
  assert.match(scanner, /BrowserMultiFormatReader/);
  assert.match(scanner, /ensureZxingLoaded/);
});

test("ISBN scanner targets book barcode formats and reports detected non-ISBN values", () => {
  const scanner = read("isbn-scanner.js");
  assert.match(scanner, /BarcodeFormat\.EAN_13/);
  assert.match(scanner, /BarcodeFormat\.EAN_8/);
  assert.match(scanner, /DecodeHintType\.TRY_HARDER/);
  assert.match(scanner, /זוהה ברקוד/);
  assert.match(scanner, /נמצא ISBN/);
  assert.match(scanner, /\(result\) =>/);
});

test("ISBN scanner prefers a rear non-ultrawide camera and offers photo fallback", () => {
  const scanner = read("isbn-scanner.js");
  assert.match(scanner, /function chooseRearCamera/);
  assert.match(scanner, /ultra\[ -\]\?wide/);
  assert.match(scanner, /enumerateDevices/);
  assert.match(scanner, /capture = "environment"/);
  assert.match(scanner, /צילום ברקוד/);
  assert.match(scanner, /decodeFromImageUrl/);
});

test("Israeli book barcode fallback uses Quagga2 EAN readers and preserves non-ISBN codes", () => {
  const html = read("isbn.html");
  const scanner = read("barcode-ean.js");
  assert.match(html, /barcode-ean\.js\?v=ean-israeli-books-20260729-1/);
  assert.match(scanner, /@ericblade\/quagga2@1\.12\.1/);
  assert.match(scanner, /"ean_reader"/);
  assert.match(scanner, /"ean_8_reader"/);
  assert.match(scanner, /"upc_reader"/);
  assert.match(scanner, /סריקת ברקוד רגיל/);
  assert.match(scanner, /\[BARCODE:\$\{code\}\]/);
  assert.match(scanner, /isRegularBarcode/);
});

test("all local script and stylesheet references exist", () => {
  for (const file of [
    "index.html",
    "isbn.html",
    "statistics.html",
    "prices.html",
    "notifications.html",
  ]) {
    if (!fs.existsSync(path.join(root, file))) continue;
    const html = read(file);
    for (const asset of localAssetsFromHtml(html)) {
      assert.equal(
        fs.existsSync(path.join(root, asset)),
        true,
        `${file} references missing ${asset}`,
      );
    }
  }
});
