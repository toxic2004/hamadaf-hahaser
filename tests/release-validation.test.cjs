const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function localAssetsFromHtml(html) {
  const assets = [];
  const pattern = /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi;
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

test("display wording consistently uses discussions", () => {
  const index = read("index.html");
  const patch = read("search-patch.js");
  assert.match(index, /data-status="בדיונים"[\s\S]*?<span>◌<\/span>בדיונים/);
  assert.doesNotMatch(index, />משא ומתן</);
  assert.match(patch, /העבר לבדיונים/);
});

test("Supabase browser dependency is pinned exactly", () => {
  for (const file of ["index.html", "isbn.html"]) {
    const html = read(file);
    assert.match(html, /@supabase\/supabase-js@2\.110\.9/);
    assert.doesNotMatch(html, /@supabase\/supabase-js@2(?:["'/])/);
  }
});

test("manual import signature is loaded through a cache-busted loader", () => {
  const index = read("index.html");
  const loader = read("safe-app-loader.js");
  assert.match(index, /safe-app-loader\.js\?v=local-import-signature-20260729-1/);
  assert.match(loader, /manual-import\.js\?v=local-import-signature-20260729-1/);
});

test("ISBN scanner loads pinned ZXing from two CDNs with fallback", () => {
  const scanner = read("isbn-scanner.js");
  assert.match(scanner, /unpkg\.com\/@zxing\/browser@0\.2\.1/);
  assert.match(scanner, /cdn\.jsdelivr\.net\/npm\/@zxing\/browser@0\.2\.1/);
  assert.match(scanner, /for \(const url of ZXING_URLS\)/);
  assert.match(scanner, /BrowserMultiFormatReader/);
  assert.match(scanner, /ensureZxingLoaded/);
});

test("all local script and stylesheet references exist", () => {
  for (const file of ["index.html", "isbn.html", "statistics.html", "prices.html", "notifications.html"]) {
    if (!fs.existsSync(path.join(root, file))) continue;
    const html = read(file);
    for (const asset of localAssetsFromHtml(html)) {
      assert.equal(fs.existsSync(path.join(root, asset)), true, `${file} references missing ${asset}`);
    }
  }
});
