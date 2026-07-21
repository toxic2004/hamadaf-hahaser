const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

test("scheduled alerts respect each user's configured hours", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/alerts/index.ts"),
    "utf8",
  );

  assert.match(source, /settings\.morning_report_hour/);
  assert.match(source, /settings\.evening_check_hour/);
  assert.match(source, /local\.hour === morningHour/);
  assert.match(source, /local\.hour === eveningHour/);
});

test("alert workflow runs hourly to support configurable hours", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/price-alerts.yml"),
    "utf8",
  );

  assert.match(workflow, /cron: "0 \* \* \* \*"/);
});
