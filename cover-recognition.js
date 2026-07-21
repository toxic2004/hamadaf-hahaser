(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let imageObjectUrl = "",
    selectedCover = "";
  function escapeHtml(value) {
    return String(value || "").replace(
      /[&<>'"]/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[ch],
    );
  }
  function normalizeText(text) {
    return String(text || "")
      .replace(/[|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function safeCover(url) {
    return String(url || "").replace(/^http:/, "https:");
  }
  function setCoverMessage(text, error = false) {
    const box = $("coverMessage");
    if (!box) return;
    box.textContent = text;
    box.className = "message" + (error ? " error" : "");
    box.style.display = text ? "block" : "none";
  }
  function setProgress(value) {
    const wrap = $("coverProgress"),
      bar = $("coverProgressBar");
    if (!wrap || !bar) return;
    wrap.style.display = value === null ? "none" : "block";
    bar.style.width = Math.max(0, Math.min(100, value || 0)) + "%";
  }
  function resetCover() {
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    imageObjectUrl = "";
    selectedCover = "";
    $("coverImage").value = "";
    $("coverPreview").removeAttribute("src");
    $("coverOcrText").value = "";
    $("coverResults").innerHTML = "";
    $("coverSaveArea").classList.add("hidden");
    $("coverRecognize").disabled = true;
    setProgress(null);
    setCoverMessage("");
  }
  async function recognizeCover() {
    const file = $("coverImage").files[0];
    if (!file) return setCoverMessage("צריך לבחור תמונה.", true);
    if (!window.Tesseract)
      return setCoverMessage(
        "רכיב זיהוי הטקסט לא נטען. בדוק את החיבור ורענן את הדף.",
        true,
      );
    $("coverRecognize").disabled = true;
    setCoverMessage("מזהה טקסט מהכריכה...");
    setProgress(1);
    try {
      const result = await Tesseract.recognize(file, "heb+eng", {
        logger: (event) => {
          if (event.status === "recognizing text")
            setProgress(Math.round((event.progress || 0) * 100));
        },
      });
      const text = normalizeText(result && result.data && result.data.text);
      $("coverOcrText").value = text;
      if (text) setCoverMessage("הטקסט זוהה. בדוק אותו ולחץ על חיפוש.");
      else
        setCoverMessage(
          "לא זוהה טקסט ברור. אפשר להקליד את שם הספר ידנית.",
          true,
        );
    } catch (error) {
      console.error("Cover OCR failed", error);
      setCoverMessage(
        "זיהוי התמונה נכשל. נסה צילום ברור יותר או הקלד את שם הספר ידנית.",
        true,
      );
    } finally {
      $("coverRecognize").disabled = false;
      setProgress(null);
    }
  }
  async function searchCoverBooks() {
    const query = normalizeText($("coverOcrText").value)
      .split(" ")
      .filter((word) => word.length > 1)
      .slice(0, 10)
      .join(" ");
    if (!query) return setCoverMessage("צריך טקסט לחיפוש.", true);
    $("coverSearch").disabled = true;
    $("coverResults").innerHTML = "";
    setCoverMessage("מחפש ספרים מתאימים...");
    try {
      const response = await fetch(
        "https://www.googleapis.com/books/v1/volumes?maxResults=10&q=" +
          encodeURIComponent(query),
      );
      if (!response.ok) throw new Error("HTTP " + response.status);
      const payload = await response.json();
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (!items.length)
        return setCoverMessage("לא נמצאו התאמות. תקן את הטקסט ונסה שוב.", true);
      $("coverResults").innerHTML = items
        .map((item, index) => {
          const info = item.volumeInfo || {},
            title = info.title || "ללא שם",
            authors = Array.isArray(info.authors)
              ? info.authors.join(", ")
              : "",
            cover = safeCover(
              info.imageLinks &&
                (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail),
            );
          return (
            '<button type="button" class="result" data-cover-index="' +
            index +
            '"><img src="' +
            escapeHtml(cover) +
            '" alt=""><span><strong>' +
            escapeHtml(title) +
            "</strong><small>" +
            escapeHtml(authors) +
            "</small></span></button>"
          );
        })
        .join("");
      $("coverResults")
        .querySelectorAll("[data-cover-index]")
        .forEach(
          (button) =>
            (button.onclick = () =>
              selectCoverBook(items[Number(button.dataset.coverIndex)])),
        );
      setCoverMessage("נמצאו " + items.length + " התאמות. בחר את הספר הנכון.");
    } catch (error) {
      console.error("Cover search failed", error);
      setCoverMessage("החיפוש נכשל. בדוק את החיבור ונסה שוב.", true);
    } finally {
      $("coverSearch").disabled = false;
    }
  }
  function selectCoverBook(item) {
    const info = item.volumeInfo || {};
    $("coverTitle").value =
      (info.title || "") + (info.subtitle ? ": " + info.subtitle : "");
    $("coverAuthor").value = Array.isArray(info.authors)
      ? info.authors.join(", ")
      : "";
    selectedCover = safeCover(
      info.imageLinks &&
        (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail),
    );
    if (selectedCover) $("selectedCover").src = selectedCover;
    else $("selectedCover").removeAttribute("src");
    $("coverNotes").value = "זוהה מתמונת כריכה";
    $("coverSaveArea").classList.remove("hidden");
    $("coverSaveArea").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function saveCoverBook() {
    const title = $("coverTitle").value.trim();
    if (!title) return setCoverMessage("צריך להזין שם ספר.", true);
    if (typeof user === "undefined" || !user)
      return setCoverMessage("צריך להתחבר מחדש.", true);
    const duplicateData = await db.from("books").select("id,title,status");
    if (duplicateData.error)
      return setCoverMessage("לא ניתן לבדוק כפילויות כרגע.", true);
    const normalizedTitle = title.toLowerCase().replace(/\s+/g, " ").trim();
    const duplicate = (duplicateData.data || []).find(
      (book) =>
        String(book.title || "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim() === normalizedTitle && book.status !== "סל מחזור",
    );
    if (duplicate)
      return setCoverMessage("הספר כבר קיים ברשימה: " + duplicate.title, true);
    $("coverSave").disabled = true;
    $("coverSave").textContent = "שומר...";
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      user_id: user.id,
      title,
      author: $("coverAuthor").value.trim(),
      cover: selectedCover,
      notes: $("coverNotes").value.trim(),
      status: "מחפש",
      created_at: now,
      updated_at: now,
    };
    const { error } = await db.from("books").insert(row);
    $("coverSave").disabled = false;
    $("coverSave").textContent = "שמירה במדף החסר";
    if (error)
      return setCoverMessage(
        "השמירה נכשלה: " + (error.message || "שגיאה לא ידועה"),
        true,
      );
    setCoverMessage("הספר נשמר במדף החסר.");
    resetCover();
  }
  function injectCoverUi() {
    const appCard = $("appCard");
    if (!appCard || $("coverRecognizer")) return;
    const style = document.createElement("style");
    style.textContent =
      ".cover-tool{margin-top:18px;padding-top:18px;border-top:1px solid var(--line)}.cover-tool .preview{display:grid;grid-template-columns:110px 1fr;gap:14px;align-items:start}.cover-tool .preview img{width:110px;height:150px;object-fit:contain;background:#eee;border-radius:12px}.cover-tool .progress{height:9px;background:#ebe6dc;border-radius:99px;overflow:hidden;display:none;margin-top:10px}.cover-tool .progress span{display:block;height:100%;width:0;background:var(--green)}.cover-tool .results{display:grid;gap:8px;margin-top:12px}.cover-tool .result{display:grid;grid-template-columns:54px 1fr;gap:9px;align-items:center;background:white;border:1px solid var(--line);text-align:right;width:100%}.cover-tool .result img{width:54px;height:72px;object-fit:contain}.cover-tool .result span{display:grid;gap:4px}.cover-tool .result small{color:var(--muted)}@media(max-width:520px){.cover-tool .preview{grid-template-columns:1fr}.cover-tool .preview img{width:100%;height:220px}}";
    document.head.appendChild(style);
    const section = document.createElement("section");
    section.id = "coverRecognizer";
    section.className = "cover-tool";
    section.innerHTML =
      '<h2>זיהוי לפי תמונת כריכה</h2><p class="sub">צלם כריכה או בחר תמונה. אין צורך לפתוח מצלמה חיה.</p><div class="field"><label>צילום או בחירת תמונה</label><input id="coverImage" type="file" accept="image/*" capture="environment"></div><div class="preview"><img id="coverPreview" alt="תצוגת הכריכה"><div><div class="actions"><button id="coverRecognize" class="primary" type="button" disabled>זיהוי טקסט</button><button id="coverReset" class="ghost" type="button">ניקוי</button></div><div id="coverProgress" class="progress"><span id="coverProgressBar"></span></div></div></div><div id="coverMessage" class="message" aria-live="polite"></div><div class="field"><label>טקסט שזוהה</label><textarea id="coverOcrText" placeholder="אפשר לתקן או להקליד כאן את שם הספר"></textarea></div><button id="coverSearch" class="primary" type="button">חיפוש ספרים מתאימים</button><div id="coverResults" class="results"></div><div id="coverSaveArea" class="hidden"><div class="preview"><img id="selectedCover" alt="כריכת הספר"><div><div class="field"><label>שם הספר</label><input id="coverTitle"></div><div class="field"><label>שם המחבר</label><input id="coverAuthor"></div></div></div><div class="field"><label>הערות</label><textarea id="coverNotes"></textarea></div><div class="actions"><button id="coverSave" class="primary" type="button">שמירה במדף החסר</button><button id="coverCancel" class="ghost" type="button">ביטול</button></div></div>';
    appCard.appendChild(section);
    $("coverImage").onchange = () => {
      const file = $("coverImage").files[0];
      if (!file) return resetCover();
      if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
      imageObjectUrl = URL.createObjectURL(file);
      $("coverPreview").src = imageObjectUrl;
      $("coverRecognize").disabled = false;
      setCoverMessage("התמונה מוכנה לזיהוי.");
    };
    $("coverRecognize").onclick = recognizeCover;
    $("coverSearch").onclick = searchCoverBooks;
    $("coverReset").onclick = resetCover;
    $("coverSave").onclick = saveCoverBook;
    $("coverCancel").onclick = () => {
      $("coverSaveArea").classList.add("hidden");
    };
  }
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  function init() {
    injectCoverUi();
    loadTesseract().catch(() =>
      setCoverMessage(
        "רכיב זיהוי הטקסט לא נטען. אפשר עדיין להקליד שם ספר ולחפש.",
        true,
      ),
    );
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
