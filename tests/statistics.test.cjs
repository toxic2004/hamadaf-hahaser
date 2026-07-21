const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateStatistics } = require("../statistics-core.js");

test("calculates complete statistics without inventing missing money", () => {
  const rows = [
    {
      title: "א",
      author: "מחבר",
      isbn: "1",
      cover: "x",
      status: "השגתי",
      created_at: "2026-07-01T00:00:00Z",
      acquired_at: "2026-07-11T00:00:00Z",
      purchase_price: 20,
      new_price: 80,
    },
    {
      title: "ב",
      author: "",
      isbn: "",
      cover: "",
      status: "מחפש",
      created_at: "2026-07-02T00:00:00Z",
      acquired_at: null,
      purchase_price: null,
      new_price: null,
    },
  ];
  const stats = calculateStatistics(
    rows,
    "all",
    new Date("2026-07-21T00:00:00Z"),
  );
  assert.equal(stats.statusCounts["השגתי"], 1);
  assert.equal(stats.statusCounts["מחפש"], 1);
  assert.equal(stats.expenses, 20);
  assert.equal(stats.savings, 60);
  assert.equal(stats.averageDays, 10);
  assert.deepEqual(stats.missing[0].fields, ["מחבר", "ISBN", "כריכה"]);
});

test("returns explicit null values when financial inputs are absent", () => {
  const stats = calculateStatistics([
    { title: "א", status: "מחפש", created_at: "2026-07-01" },
  ]);
  assert.equal(stats.expenses, null);
  assert.equal(stats.savings, null);
  assert.equal(stats.averageDays, null);
});
