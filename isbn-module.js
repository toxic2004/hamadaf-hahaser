(function () {
  "use strict";

  const GOOGLE_BOOKS_API =
    "https://www.googleapis.com/books/v1/volumes?q=isbn:";
  let scannerControls = null;

  function cleanIsbn(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^0-9X]/g, "");
  }

  function isValidIsbn10(value) {
    const isbn = cleanIsbn(value);
    if (!/^\d{9}[\dX]$/.test(isbn)) return false;
    const sum = [...isbn].reduce((total, char, index) => {
      const digit = char === "X" ? 10 : Number(char);
      return total + digit * (10 - index);
    }, 0);
    return sum % 11 === 0;
  }

  function isValidIsbn13(value) {
    const isbn = cleanIsbn(value);
    if (!/^\d{13}$/.test(isbn)) return false;
    const sum = [...isbn.slice(0, 12)].reduce(
      (total, char, index) => total + Number(char) * (index % 2 === 0 ? 1 : 3),
      0,
    );
    const checkDigit = (10 - (sum % 10)) % 10;
    return checkDigit === Number(isbn[12]);
  }

  function isValidIsbn(value) {
    const isbn = cleanIsbn(value);
    return isbn.length === 10 ? isValidIsbn10(isbn) : isValidIsbn13(isbn);
  }

  function showMessage(message, type) {
    const box = document.getElementById("isbnMessage");
    if (!box) return;
    box.textContent = message;
    box.style.color = type === "error" ? "#a94a45" : "#285f50";
  }

  function findDuplicate(isbn) {
    const normalized = cleanIsbn(isbn);
    return ((window.state && state.books) || []).find(
      (book) =>
        cleanIsbn(book.isbn) === normalized && book.status !== "סל מחזור",
    );
  }

  async function fetchBookByIsbn(rawIsbn) {
    const isbn = cleanIsbn(rawIsbn);
    if (!isValidIsbn(isbn)) {
      throw new Error("מספר ה־ISBN אינו תקין");
    }

    const duplicate = findDuplicate(isbn);
    if (duplicate) {
      throw new Error("הספר עם ISBN זה כבר קיים ברשימה: " + duplicate.title);
    }

    showMessage("מחפש את פרטי הספר...");
    const response = await fetch(GOOGLE_BOOKS_API + encodeURIComponent(isbn));
    if (!response.ok) throw new Error("לא ניתן להתחבר למאגר הספרים");
    const payload = await response.json();
    const item = payload.items && payload.items[0];
    if (!item) throw new Error("לא נמצאו פרטים לספר הזה");

    const info = item.volumeInfo || {};
    const title = info.title || "";
    const subtitle = info.subtitle ? ": " + info.subtitle : "";
    const authors = Array.isArray(info.authors) ? info.authors.join(", ") : "";
    const cover =
      (info.imageLinks &&
        (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) ||
      "";

    if (!title) throw new Error("נמצא ספר, אך שם הספר חסר במאגר");

    const confirmation = [
      "נמצא הספר הבא:",
      "",
      title + subtitle,
      authors ? "מחבר: " + authors : "מחבר: לא נמצא",
      "ISBN: " + isbn,
      "",
      "להעתיק את הפרטים לטופס?",
    ].join("\n");

    if (!window.confirm(confirmation)) {
      showMessage("הפרטים לא הועתקו");
      return;
    }

    document.getElementById("isbn").value = isbn;
    document.getElementById("bookTitle").value = title + subtitle;
    document.getElementById("author").value = authors;

    if (cover && window.importCover) {
      showMessage("מעתיק את הכריכה...");
      const storedCover = await window.importCover(
        cover.replace("http://", "https://"),
      );
      if (storedCover) {
        document.getElementById("coverData").value = storedCover;
        if (window.showPreview) window.showPreview(storedCover);
      }
    }

    showMessage("הפרטים נמצאו. בדוק אותם ולחץ שמירה.");
  }

  async function startScanner() {
    const scannerModal = document.getElementById("isbnScannerModal");
    const video = document.getElementById("isbnVideo");
    scannerModal.classList.add("open");

    try {
      if (!window.ZXingBrowser) {
        showMessage("רכיב הסריקה עדיין נטען. נסה שוב בעוד רגע.", "error");
        return;
      }
      const reader = new ZXingBrowser.BrowserMultiFormatReader();
      scannerControls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        video,
        async (result) => {
          if (!result) return;
          const value = cleanIsbn(result.getText());
          if (!isValidIsbn(value)) return;
          stopScanner();
          scannerModal.classList.remove("open");
          document.getElementById("isbn").value = value;
          try {
            await fetchBookByIsbn(value);
          } catch (error) {
            showMessage(error.message, "error");
          }
        },
      );
    } catch (error) {
      stopScanner();
      showMessage("המצלמה לא נפתחה. אפשר להזין ISBN ידנית.", "error");
    }
  }

  function stopScanner() {
    if (scannerControls) {
      scannerControls.stop();
      scannerControls = null;
    }
    const video = document.getElementById("isbnVideo");
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
  }

  function injectUi() {
    const titleField = document.getElementById("bookTitle")?.closest(".field");
    if (!titleField || document.getElementById("isbn")) return;

    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML = `
      <label>ISBN</label>
      <div class="row">
        <input id="isbn" inputmode="numeric" autocomplete="off" placeholder="ISBN-10 או ISBN-13">
        <button id="scanIsbn" type="button" class="ghost">סריקה במצלמה</button>
      </div>
      <div class="actions" style="margin-top:8px">
        <button id="lookupIsbn" type="button" class="ghost">איתור פרטי הספר</button>
      </div>
      <p id="isbnMessage" class="sub" aria-live="polite"></p>`;
    titleField.parentNode.insertBefore(field, titleField);

    const modal = document.createElement("div");
    modal.id = "isbnScannerModal";
    modal.className = "overlay";
    modal.innerHTML = `
      <div class="modal" style="max-width:520px;align-self:center">
        <div class="head"><h2>סריקת ISBN</h2><button id="closeIsbnScanner" class="close" type="button">×</button></div>
        <p class="sub">כוון את המצלמה לברקוד שבגב הספר.</p>
        <video id="isbnVideo" playsinline muted style="width:100%;min-height:260px;background:#111;border-radius:16px"></video>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById("lookupIsbn").onclick = async () => {
      try {
        await fetchBookByIsbn(document.getElementById("isbn").value);
      } catch (error) {
        showMessage(error.message, "error");
      }
    };
    document.getElementById("scanIsbn").onclick = startScanner;
    document.getElementById("closeIsbnScanner").onclick = () => {
      stopScanner();
      modal.classList.remove("open");
    };
    modal.onclick = (event) => {
      if (event.target === modal) {
        stopScanner();
        modal.classList.remove("open");
      }
    };
  }

  function patchDataMapping() {
    if (!window.rowToBook || !window.bookToRow || !window.saveBook) return;

    const originalRowToBook = window.rowToBook;
    const originalBookToRow = window.bookToRow;
    const originalSaveBook = window.saveBook;
    const originalOpenAdd = window.openAdd;
    const originalEditBook = window.editBook;

    window.rowToBook = function (row) {
      return Object.assign(originalRowToBook(row), { isbn: row.isbn || "" });
    };

    window.bookToRow = function (book) {
      return Object.assign(originalBookToRow(book), {
        isbn: cleanIsbn(book.isbn) || null,
      });
    };

    window.saveBook = async function () {
      const field = document.getElementById("isbn");
      const isbn = cleanIsbn(field && field.value);
      if (isbn && !isValidIsbn(isbn))
        return window.toast("מספר ה־ISBN אינו תקין");
      const duplicate = isbn && findDuplicate(isbn);
      if (duplicate && duplicate.id !== document.getElementById("id").value) {
        return window.toast("הספר עם ISBN זה כבר קיים ברשימה");
      }
      if (window.state && state.selected) state.selected.isbn = isbn;
      await originalSaveBook();
      const saved =
        window.state &&
        state.books.find(
          (book) => book.id === document.getElementById("id").value,
        );
      if (saved) saved.isbn = isbn;
    };

    window.openAdd = function () {
      originalOpenAdd();
      const field = document.getElementById("isbn");
      if (field) field.value = "";
      showMessage("");
    };

    window.editBook = function () {
      originalEditBook();
      const field = document.getElementById("isbn");
      if (field) field.value = (state.selected && state.selected.isbn) || "";
    };

    document.getElementById("save").onclick = window.saveBook;
    document.getElementById("add").onclick = window.openAdd;
  }

  function loadScannerLibrary() {
    if (window.ZXingBrowser) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/index.min.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function initIsbnModule() {
    injectUi();
    patchDataMapping();
    loadScannerLibrary().catch(() =>
      showMessage("רכיב הסריקה לא נטען. הזנה ידנית עדיין זמינה.", "error"),
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initIsbnModule, {
      once: true,
    });
  } else {
    initIsbnModule();
  }
})();
