import fs from "node:fs";

const [runPath, resultPath, summaryPath] = process.argv.slice(2);
const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
const items = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const item = items[0];
const offer = item?.offers?.[0];
const valid =
  item?.status === "נמצא" &&
  offer?.source === "סיפור חוזר" &&
  offer?.availability === "במלאי" &&
  Number.isFinite(offer?.itemPrice) &&
  offer.itemPrice > 0 &&
  /^https:\/\/rebooks\.org\.il\/product\/[^/]+\/?$/u.test(offer.productUrl) &&
  offer.qualifyingOptions?.some(
    (option) => Number.isFinite(option.totalPrice) && option.totalPrice <= 30,
  );

const summary = {
  valid,
  runId: run.id || null,
  runStatus: run.status || null,
  usageTotalUsd: run.usageTotalUsd ?? null,
  result: item || null,
};
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
if (!valid) {
  console.error("Apify returned no valid concrete Sipur Hozer offer.");
  process.exitCode = 1;
}
