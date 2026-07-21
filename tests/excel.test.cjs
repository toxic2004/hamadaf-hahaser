const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const ExcelJS = require("exceljs");
const excel = require("../excel-export.js");

test("creates a real Hebrew XLSX workbook with required sheets and tables", async () => {
  const books = [
    {
      title: "הספר הראשון",
      author: "מחבר",
      isbn: "9780306406157",
      status: "מחפש",
      priority: "דחופה",
      isFavorite: true,
      isRequired: true,
      notes: "הערה",
      created: Date.now(),
      cover: "data:image/jpeg;base64,x",
    },
    {
      title: "ספר שהושג",
      author: "מחברת",
      status: "השגתי",
      priority: "רגילה",
      purchasePrice: 20,
      newPrice: 80,
      acquiredAt: Date.now(),
      created: Date.now() - 1000,
    },
  ];
  const workbook = await excel.buildWorkbook(books, ExcelJS);
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ["סיכום", "כל הספרים", "מחפש", "משא ומתן", "סל מחזור", "סטטיסטיקות"],
  );
  assert.equal(workbook.getWorksheet("כל הספרים").getTables().length, 1);
  assert.equal(workbook.getWorksheet("כל הספרים").views[0].rightToLeft, true);
  assert.equal(workbook.getWorksheet("כל הספרים").views[0].state, "frozen");
  const buffer = await workbook.xlsx.writeBuffer();
  await fs.writeFile("/tmp/hamadaf-export-test.xlsx", Buffer.from(buffer));
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  assert.equal(
    reopened.getWorksheet("כל הספרים").getCell("A2").value,
    "הספר הראשון",
  );
});

test("keeps Hebrew text and each book status in the correct worksheet", async () => {
  const books = [
    { title: "ספר בדיונים", status: "בדיונים", created: Date.now() },
    {
      title: "ספר שמחכה לתשובה",
      status: "מחכה לתשובה",
      created: Date.now(),
    },
    { title: "ספר בסל", status: "סל מחזור", created: Date.now() },
  ];
  const workbook = await excel.buildWorkbook(books, ExcelJS);
  const negotiations = workbook.getWorksheet("משא ומתן");
  const trash = workbook.getWorksheet("סל מחזור");
  assert.equal(negotiations.views[0].rightToLeft, true);
  assert.equal(trash.views[0].rightToLeft, true);
  assert.deepEqual(
    [negotiations.getCell("A2").value, negotiations.getCell("A3").value],
    ["ספר בדיונים", "ספר שמחכה לתשובה"],
  );
  assert.equal(trash.getCell("A2").value, "ספר בסל");
});

test("uses an Israel local timestamp in the exported filename", () => {
  assert.match(
    excel.fileName(new Date("2026-07-21T05:07:00Z")),
    /2026-07-21 08-07\.xlsx$/,
  );
});
