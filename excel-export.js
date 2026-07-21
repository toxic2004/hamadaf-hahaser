(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HamadafExcel = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const STATUS_COLORS = {
    מחפש: "DCEBE4",
    בדיונים: "FFF0D8",
    "מחכה לתשובה": "E6ECF6",
    השגתי: "E2F0DF",
    "סל מחזור": "F3E7E5",
  };

  function asDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizedBook(book) {
    const purchasePrice = numberOrNull(
      book.purchasePrice ?? book.purchase_price,
    );
    const newPrice = numberOrNull(book.newPrice ?? book.new_price);
    return {
      title: book.title || "",
      author: book.author || "",
      isbn: book.isbn || "",
      status: book.status || "מחפש",
      priority: book.priority || "רגילה",
      favorite: (book.isFavorite ?? book.is_favorite) ? "כן" : "לא",
      required: (book.isRequired ?? book.is_required) ? "כן" : "לא",
      notes: book.notes || "",
      created: asDate(book.created ?? book.created_at),
      acquired: asDate(book.acquiredAt ?? book.acquired_at),
      purchasePrice,
      newPrice,
      savings:
        purchasePrice !== null && newPrice !== null
          ? newPrice - purchasePrice
          : null,
      hasCover: book.cover ? "כן" : "לא",
    };
  }

  function columns() {
    return [
      { name: "שם הספר", width: 34 },
      { name: "שם המחבר", width: 25 },
      { name: "ISBN", width: 18 },
      { name: "מצב", width: 16 },
      { name: "עדיפות", width: 13 },
      { name: "מועדף", width: 11 },
      { name: "ספר חובה", width: 12 },
      { name: "הערות", width: 42 },
      { name: "תאריך הוספה", width: 15 },
      { name: "תאריך השגה", width: 15 },
      { name: "מחיר ששולם", width: 14 },
      { name: "מחיר חדש", width: 13 },
      { name: "חיסכון", width: 13 },
      { name: "קיימת כריכה", width: 14 },
    ];
  }

  function row(book) {
    return [
      book.title,
      book.author,
      book.isbn,
      book.status,
      book.priority,
      book.favorite,
      book.required,
      book.notes,
      book.created,
      book.acquired,
      book.purchasePrice,
      book.newPrice,
      book.savings,
      book.hasCover,
    ];
  }

  function setupWorksheet(worksheet) {
    worksheet.views = [{ state: "frozen", ySplit: 1, rightToLeft: true }];
    worksheet.pageSetup = {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
    };
    worksheet.properties.defaultRowHeight = 20;
  }

  function addBookSheet(workbook, name, tableName, books) {
    const worksheet = workbook.addWorksheet(name, {
      views: [{ rightToLeft: true }],
    });
    setupWorksheet(worksheet);
    const definitions = columns();
    worksheet.addTable({
      name: tableName,
      ref: "A1",
      headerRow: true,
      totalsRow: false,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: definitions.map((column) => ({
        name: column.name,
        filterButton: true,
      })),
      rows: books.map(row),
    });
    definitions.forEach((column, index) => {
      worksheet.getColumn(index + 1).width = column.width;
    });
    worksheet.getColumn(9).numFmt = "dd/mm/yyyy";
    worksheet.getColumn(10).numFmt = "dd/mm/yyyy";
    [11, 12, 13].forEach((index) => {
      worksheet.getColumn(index).numFmt = "#,##0.00 [$₪-he-IL]";
    });
    books.forEach((book, index) => {
      const excelRow = worksheet.getRow(index + 2);
      excelRow.alignment = {
        vertical: "top",
        wrapText: true,
        readingOrder: "rtl",
      };
      const color = STATUS_COLORS[book.status];
      if (color)
        excelRow.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: color },
          };
        });
    });
    return worksheet;
  }

  function summaryRows(books) {
    const count = (status) =>
      books.filter((book) => book.status === status).length;
    const priced = books.filter((book) => book.purchasePrice !== null);
    const comparable = books.filter(
      (book) => book.purchasePrice !== null && book.newPrice !== null,
    );
    const expenses = priced.reduce((sum, book) => sum + book.purchasePrice, 0);
    const savings = comparable.reduce(
      (sum, book) => sum + book.newPrice - book.purchasePrice,
      0,
    );
    return [
      ["כל הספרים", books.length, ""],
      ["מחפש", count("מחפש"), ""],
      ["משא ומתן", count("בדיונים"), ""],
      ["מחכה לתשובה", count("מחכה לתשובה"), ""],
      ["הושג", count("השגתי"), ""],
      ["סל מחזור", count("סל מחזור"), ""],
      [
        "הוצאות בפועל",
        priced.length ? expenses : "חסר מידע",
        priced.length
          ? `מבוסס על ${priced.length} ספרים`
          : "לא הוזנו מחירי רכישה",
      ],
      [
        "חיסכון מול חדש",
        comparable.length ? savings : "חסר מידע",
        comparable.length
          ? `מבוסס על ${comparable.length} ספרים`
          : "נדרשים שני המחירים",
      ],
    ];
  }

  async function buildWorkbook(inputBooks, ExcelJSRef) {
    if (!ExcelJSRef?.Workbook) throw new Error("ExcelJS is unavailable");
    const books = inputBooks
      .map(normalizedBook)
      .sort(
        (a, b) => (b.created?.getTime() || 0) - (a.created?.getTime() || 0),
      );
    const workbook = new ExcelJSRef.Workbook();
    workbook.creator = "המדף החסר";
    workbook.created = new Date();
    workbook.modified = new Date();
    const summary = workbook.addWorksheet("סיכום", {
      views: [{ rightToLeft: true }],
    });
    setupWorksheet(summary);
    summary.addTable({
      name: "SummaryTable",
      ref: "A1",
      headerRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: [
        { name: "מדד", filterButton: true },
        { name: "ערך", filterButton: true },
        { name: "הערה", filterButton: true },
      ],
      rows: summaryRows(books),
    });
    summary.getColumn(1).width = 26;
    summary.getColumn(2).width = 18;
    summary.getColumn(3).width = 38;
    addBookSheet(workbook, "כל הספרים", "AllBooksTable", books);
    addBookSheet(
      workbook,
      "מחפש",
      "SearchingBooksTable",
      books.filter((book) => book.status === "מחפש"),
    );
    addBookSheet(
      workbook,
      "משא ומתן",
      "NegotiationBooksTable",
      books.filter((book) => ["בדיונים", "מחכה לתשובה"].includes(book.status)),
    );
    addBookSheet(
      workbook,
      "סל מחזור",
      "TrashBooksTable",
      books.filter((book) => book.status === "סל מחזור"),
    );
    const statistics = workbook.addWorksheet("סטטיסטיקות", {
      views: [{ rightToLeft: true }],
    });
    setupWorksheet(statistics);
    statistics.addTable({
      name: "StatisticsTable",
      ref: "A1",
      headerRow: true,
      style: { theme: "TableStyleMedium4", showRowStripes: true },
      columns: [
        { name: "מדד", filterButton: true },
        { name: "ערך", filterButton: true },
        { name: "הערה", filterButton: true },
      ],
      rows: summaryRows(books),
    });
    statistics.getColumn(1).width = 26;
    statistics.getColumn(2).width = 18;
    statistics.getColumn(3).width = 38;
    return workbook;
  }

  function fileName(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const value = (type) => parts.find((part) => part.type === type)?.value;
    return `המדף החסר ${value("year")}-${value("month")}-${value("day")} ${value("hour")}-${value("minute")}.xlsx`;
  }

  async function downloadWorkbook(books, ExcelJSRef) {
    const workbook = await buildWorkbook(books, ExcelJSRef);
    const buffer = await workbook.xlsx.writeBuffer();
    const file = new File([buffer], fileName(), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    if (
      /iPhone|iPad|iPod/.test(navigator.userAgent) &&
      navigator.canShare?.({ files: [file] })
    ) {
      try {
        await navigator.share({ files: [file], title: "המדף החסר" });
        return file;
      } catch (error) {
        if (error.name === "AbortError") return file;
      }
    }
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return file;
  }

  return { buildWorkbook, downloadWorkbook, fileName, normalizedBook };
});
