const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

async function smtpClient() {
  return import(path.join(root, "supabase/functions/alerts/smtp-client.mjs"));
}

function decodeBase64Utf8(value) {
  return decodeURIComponent(escape(Buffer.from(value, "base64").toString("binary")));
}

function decodeSubjectHeader(rawSubjectValue) {
  const match = rawSubjectValue.match(/^=\?UTF-8\?B\?([^?]+)\?=$/);
  assert.ok(match, `subject header should be a UTF-8 base64 encoded-word: ${rawSubjectValue}`);
  return decodeBase64Utf8(match[1]);
}

test("MIME message carries exact from/to/subject headers", async () => {
  const { buildMimeMessage } = await smtpClient();
  const message = buildMimeMessage({
    from: "toxic2004@gmail.com",
    to: "toxic2004@gmail.com",
    subject: "המדף החסר: דוח בוקר 15.08.2026",
    html: "<p>שלום</p>",
    text: "שלום",
  });
  const headerBlock = message.split("\r\n\r\n")[0];
  const headers = Object.fromEntries(
    headerBlock.split("\r\n").map((line) => {
      const index = line.indexOf(":");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
  );
  assert.equal(headers.From, "toxic2004@gmail.com");
  assert.equal(headers.To, "toxic2004@gmail.com");
  assert.equal(decodeSubjectHeader(headers.Subject), "המדף החסר: דוח בוקר 15.08.2026");
  assert.equal(headers["MIME-Version"], "1.0");
  assert.match(headers["Content-Type"], /multipart\/alternative; boundary="/);
});

test("MIME message round-trips Hebrew HTML and plain text bodies exactly", async () => {
  const { buildMimeMessage } = await smtpClient();
  const html = "<div dir=\"rtl\">מחיר כולל: 20 ₪, זמינות: במלאי</div>";
  const text = "מחיר כולל: 20 ₪";
  const message = buildMimeMessage({
    from: "a@example.com",
    to: "a@example.com",
    subject: "בדיקה",
    html,
    text,
  });
  const boundaryMatch = message.match(/boundary="([^"]+)"/);
  assert.ok(boundaryMatch, "expected a MIME boundary to be present");
  const boundary = boundaryMatch[1];
  const parts = message
    .split(`--${boundary}`)
    .filter((part) => part.includes("text/plain") || part.includes("text/html"));

  assert.equal(parts.length, 2, "expected exactly one text/plain and one text/html part");

  for (const part of parts) {
    const [rawHeaders, ...bodyLines] = part.trim().split("\r\n");
    void rawHeaders;
    const isHtmlPart = part.includes("text/html");
    const base64Body = bodyLines.filter((line) => line && !line.startsWith("Content-")).join("");
    const decoded = decodeBase64Utf8(base64Body);
    assert.equal(decoded, isHtmlPart ? html : text);
  }
});

test("a body line that starts with a dot cannot be produced by base64 encoding (dot-stuffing is moot for this encoder)", async () => {
  const { buildMimeMessage } = await smtpClient();
  const html = ".a line that looks like an SMTP terminator\n.\nmore text";
  const message = buildMimeMessage({
    from: "a@example.com",
    to: "a@example.com",
    subject: "בדיקה",
    html,
    text: "",
  });
  // Because the body is base64-encoded, no line of the actual wire message
  // can ever start with a literal ".", regardless of what the source HTML
  // contains. This guards the assumption the SMTP client's dot-stuffing
  // step relies on staying true if the encoding ever changes.
  const bodyLines = message.split("\r\n");
  for (const line of bodyLines) {
    if (line.startsWith("--")) continue;
    assert.notEqual(line.trim()[0], ".", `unexpected literal dot-leading line: "${line}"`);
  }
});
