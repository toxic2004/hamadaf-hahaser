(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HamadafStatistics = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function dateValue(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
  }
  function startFor(period, now) {
    if (period === "month")
      return new Date(now.getFullYear(), now.getMonth(), 1);
    if (period === "year") return new Date(now.getFullYear(), 0, 1);
    return null;
  }
  function inPeriod(value, start) {
    const date = dateValue(value);
    return Boolean(date && (!start || date >= start));
  }
  function calculateStatistics(rows, period = "all", now = new Date()) {
    const start = startFor(period, now);
    const scoped = start
      ? rows.filter(
          (book) =>
            inPeriod(book.created_at, start) ||
            inPeriod(book.acquired_at, start),
        )
      : rows;
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const statuses = ["מחפש", "בדיונים", "מחכה לתשובה", "השגתי", "סל מחזור"];
    const statusCounts = Object.fromEntries(
      statuses.map((status) => [
        status,
        scoped.filter((book) => book.status === status).length,
      ]),
    );
    const priced = scoped.filter(
      (book) =>
        book.purchase_price !== null && book.purchase_price !== undefined,
    );
    const comparable = scoped.filter(
      (book) =>
        book.purchase_price !== null &&
        book.purchase_price !== undefined &&
        book.new_price !== null &&
        book.new_price !== undefined,
    );
    const completed = scoped.filter(
      (book) =>
        book.status === "השגתי" &&
        dateValue(book.created_at) &&
        dateValue(book.acquired_at),
    );
    const averageDays = completed.length
      ? completed.reduce(
          (sum, book) =>
            sum +
            Math.max(
              0,
              dateValue(book.acquired_at) - dateValue(book.created_at),
            ),
          0,
        ) /
        completed.length /
        86400000
      : null;
    const missing = rows
      .filter((book) => book.status !== "סל מחזור")
      .map((book) => ({
        title: book.title || "ללא שם",
        fields: [
          !book.author && "מחבר",
          !book.isbn && "ISBN",
          !book.cover && "כריכה",
        ].filter(Boolean),
      }))
      .filter((book) => book.fields.length);
    return {
      scoped,
      statusCounts,
      addedThisMonth: rows.filter((book) =>
        inPeriod(book.created_at, currentMonth),
      ).length,
      boughtThisMonth: rows.filter(
        (book) =>
          book.status === "השגתי" && inPeriod(book.acquired_at, currentMonth),
      ).length,
      expenses: priced.length
        ? priced.reduce((sum, book) => sum + Number(book.purchase_price), 0)
        : null,
      expenseCoverage: priced.length,
      savings: comparable.length
        ? comparable.reduce(
            (sum, book) =>
              sum + Number(book.new_price) - Number(book.purchase_price),
            0,
          )
        : null,
      savingsCoverage: comparable.length,
      averageDays,
      averageCoverage: completed.length,
      missing,
    };
  }
  return { calculateStatistics };
});
