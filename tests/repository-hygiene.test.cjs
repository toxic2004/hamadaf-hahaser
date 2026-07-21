const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("ignores local credentials, caches and generated files", () => {
  const rules = new Set(
    readFileSync(path.join(root, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );

  const requiredRules = [
    "node_modules/",
    "dist/",
    "*.log",
    ".env",
    ".env.*",
    "!.env.example",
    ".npmrc",
    "*.key",
    "*.pem",
    ".cache/",
    ".npm/",
    ".supabase/",
    ".tmp/",
    "tmp/",
    "temp/",
    "*.tmp",
    "coverage/",
    ".DS_Store",
  ];

  for (const rule of requiredRules) {
    assert.ok(rules.has(rule), `Missing .gitignore rule: ${rule}`);
  }
});

test("does not track local credentials, caches or generated files", () => {
  const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);

  const forbidden = trackedFiles.filter((file) => {
    const segments = file.split("/");
    const base = segments.at(-1);
    return (
      segments.some((segment) =>
        [
          "node_modules",
          "dist",
          ".cache",
          ".npm",
          ".supabase",
          ".tmp",
          "tmp",
          "temp",
          "coverage",
        ].includes(segment),
      ) ||
      base === ".env" ||
      (base.startsWith(".env.") && base !== ".env.example") ||
      base === ".npmrc" ||
      base === ".DS_Store" ||
      /\.(?:key|pem|log|tmp)$/i.test(base)
    );
  });

  assert.deepEqual(forbidden, []);
});
