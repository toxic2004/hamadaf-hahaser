const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");

test("camera scan fills a valid ISBN and continues to confirmation", async () => {
  const dom = new JSDOM(
    `<!doctype html><button id="scanIsbn"></button><section id="isbnScanner"><button id="closeScanner"></button><video id="isbnVideo"></video><p id="scannerMessage"></p></section><input id="isbn">`,
    { url: "https://example.test/", runScripts: "outside-only" },
  );
  const { window } = dom;
  let lookedUp = false;
  let stopped = false;
  Object.defineProperty(window.navigator, "mediaDevices", {
    value: { getUserMedia() {} },
    configurable: true,
  });
  window.HamadafIsbn = {
    clean: (value) => String(value).replace(/\D/g, ""),
    isValidIsbn: (value) => value === "9780306406157",
  };
  window.lookupBook = async () => {
    lookedUp = true;
  };
  window.ZXingBrowser = {
    BrowserMultiFormatReader: class {
      async decodeFromConstraints(constraints, video, callback) {
        assert.equal(constraints.video.facingMode.ideal, "environment");
        assert.equal(video.id, "isbnVideo");
        callback({ getText: () => "9780306406157" });
        return {
          stop() {
            stopped = true;
          },
        };
      }
    },
  };
  window.eval(fs.readFileSync(path.join(root, "isbn-scanner.js"), "utf8"));
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  window.document.getElementById("scanIsbn").click();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(window.document.getElementById("isbn").value, "9780306406157");
  assert.equal(lookedUp, true);
  assert.equal(stopped, true);
  assert.equal(
    window.document.getElementById("isbnScanner").classList.contains("open"),
    false,
  );
});
