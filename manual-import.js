(function exposeManualImport(global) {
  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0591-\u05c7]/g, "")
      .replace(/[^\u0590-\u05ffa-z0-9]/g, "");
  }

  function normalizeIsbn(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^0-9X]/g, "");
  }

  function parseLocalBooks(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      const books = parsed.filter(
        (book) =>
          book &&
          typeof book === "object" &&
          typeof book.title === "string" &&
          book.title.trim(),
      );
      return books.length ? books : null;
    } catch (_error) {
      return null;
    }
  }

  function duplicateKey(book) {
    const isbn = normalizeIsbn(book && book.isbn);
    if (isbn) return "isbn:" + isbn;
    const title = normalize(book && book.title);
    const author = normalize(book && book.author);
    return author ? "title-author:" + title + ":" + author : "title:" + title;
  }

  function analyze(localBooks, remoteBooks) {
    const occupied = new Set((remoteBooks || []).map(duplicateKey));
    const newBooks = [];
    let duplicateCount = 0;

    for (const book of localBooks || []) {
      const key = duplicateKey(book);
      if (!key || occupied.has(key)) {
        duplicateCount += 1;
        continue;
      }
      occupied.add(key);
      newBooks.push(book);
    }

    return {
      localCount: (localBooks || []).length,
      duplicateCount,
      newCount: newBooks.length,
      newBooks,
    };
  }

  function ensureModal(document) {
    let overlay = document.getElementById("localImportModal");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "localImportModal";
    overlay.className = "overlay";
    overlay.innerHTML =
      '<div class="modal" style="max-width:520px;align-self:center">' +
      '<div class="head"><h2>ייבוא רשימה מקומית</h2></div>' +
      '<p>נמצאה רשימת ספרים שנשמרה בדפדפן הזה.</p>' +
      '<div id="localImportSummary"></div>' +
      '<p class="sub">כפילות נקבעת לפי ISBN. כשאין ISBN, לפי שם הספר והמחבר. כשאין מחבר, לפי שם הספר.</p>' +
      '<p id="localImportError" class="sub"></p>' +
      '<div class="actions">' +
      '<button id="confirmLocalImport" class="primary">אישור ייבוא</button>' +
      '<button id="cancelLocalImport" class="ghost">ביטול</button>' +
      "</div></div>";
    document.body.appendChild(overlay);
    return overlay;
  }

  function showConfirmation(document, analysis) {
    const overlay = ensureModal(document);
    document.getElementById("localImportSummary").innerHTML =
      "<p><strong>ספרים ברשימה המקומית:</strong> " +
      analysis.localCount +
      "</p><p><strong>כפילויות:</strong> " +
      analysis.duplicateCount +
      "</p><p><strong>ספרים חדשים לייבוא:</strong> " +
      analysis.newCount +
      "</p>";
    document.getElementById("localImportError").textContent = "";
    overlay.classList.add("open");
    return overlay;
  }

  function waitForDecision(document, analysis) {
    const overlay = showConfirmation(document, analysis);
    const confirmButton = document.getElementById("confirmLocalImport");
    const cancelButton = document.getElementById("cancelLocalImport");

    return new Promise((resolve) => {
      function finish(confirmed) {
        confirmButton.onclick = null;
        cancelButton.onclick = null;
        if (!confirmed) overlay.classList.remove("open");
        resolve(confirmed);
      }
      confirmButton.onclick = () => finish(true);
      cancelButton.onclick = () => finish(false);
    });
  }

  async function promptAndImport(options) {
    const {
      document,
      db,
      user,
      localBooks,
      remoteBooks,
      bookToRow,
      onImported,
    } = options;

    if (!user || !localBooks || !localBooks.length) {
      return { status: "not-needed", imported: 0 };
    }

    const analysis = analyze(localBooks, remoteBooks);
    const confirmed = await waitForDecision(document, analysis);
    if (!confirmed) return { status: "cancelled", imported: 0, analysis };

    if (!analysis.newBooks.length) {
      document.getElementById("localImportModal").classList.remove("open");
      return { status: "completed", imported: 0, analysis };
    }

    const confirmButton = document.getElementById("confirmLocalImport");
    const errorText = document.getElementById("localImportError");
    confirmButton.disabled = true;
    confirmButton.textContent = "מייבא...";

    const rows = analysis.newBooks.map(bookToRow);
    const { error } = await db.from("books").upsert(rows);
    confirmButton.disabled = false;
    confirmButton.textContent = "אישור ייבוא";

    if (error) {
      errorText.textContent = "הייבוא נכשל. לא בוצע שינוי בתצוגה המקומית.";
      return { status: "failed", imported: 0, analysis, error };
    }

    document.getElementById("localImportModal").classList.remove("open");
    if (typeof onImported === "function") onImported(analysis.newBooks);
    return {
      status: "completed",
      imported: analysis.newBooks.length,
      analysis,
    };
  }

  global.HamadafManualImport = {
    analyze,
    duplicateKey,
    parseLocalBooks,
    promptAndImport,
  };
})(typeof window === "undefined" ? globalThis : window);
