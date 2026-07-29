(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let imageObjectUrl = "",
    selectedCover = "",
    lastCandidates = [];

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[ch]);
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/[|]+/g, " ")
      .replace(/[\u200e\u200f]/g, " ")
      .replace(/[^\u0590-\u05ffA-Za-z0-9'\".,:!?()\n ]+/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizedWords(text) {
    return normalizeText(text)
      .toLowerCase()
      .replace(/[.,:!?()'\"]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1);
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
    lastCandidates = [];
    $("coverImage").value = "";
    $("coverPreview").removeAttribute("src");
    $("coverOcrText").value = "";
    $("coverResults").innerHTML = "";
    $("coverSaveArea").classList.add("hidden");
    $("coverRecognize").disabled = true;
    setProgress(null);
    setCoverMessage("");
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("IMAGE_LOAD_FAILED"));
      };
      image.src = url;
    });
  }

  async function prepareImage(file) {
    const image = await loadImage(file);
    const maxWidth = 1800;
    const scale = Math.min(1, maxWidth / image.naturalWidth);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const contrast = gray < 145 ? Math.max(0, gray * 0.72) : Math.min(255, 128 + (gray - 128) * 1.45);
      data[i] = contrast;
      data[i + 1] = contrast;
      data[i + 2] = contrast;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  }

  function chooseBestOcr(results) {
    return results
      .map((result) => {
        const text = normalizeText(result && result.data && result.data.text);
        const hebrew = (text.match(/[\u0590-\u05ff]/g) || []).length;
        const useful = normalizedWords(text).length;
        const confidence = Number(result && result.data && result.data.confidence) || 0;
        return { text, score: hebrew * 3 + useful * 2 + confidence / 5 };
      })
      .sort((a, b) => b.score - a.score)[0];
  }

  function buildQueries(text) {
    const lines = normalizeText(text)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => normalizedWords(line).length >= 2);
    const words = normalizedWords(text);
    const queries = [];
    lines.slice(0, 4).forEach((line) => queries.push(line));
    if (lines.length >= 2) queries.push(lines.slice(0, 2).join(" "));
    if (words.length) queries.push(words.slice(0, 12).join(" "));
    if (words.length > 5) queries.push(words.slice(0, 6).join(" "));
    return [...new Set(queries.map(normalizeText).filter(Boolean))].slice(0, 6);
  }

  function scoreCandidate(item, ocrText) {
    const info = item.volumeInfo || {};
    const source = new Set(normalizedWords(ocrText));
    const titleWords = normalizedWords(info.title || "");
    const authorWords = normalizedWords((info.authors || []).join(" "));
    let score = 0;
    titleWords.forEach((word) => {
      if (source.has(word)) score += 8;
    });
    authorWords.forEach((word) => {
      if (source.has(word)) score += 5;
    });
    if (info.language === "he") score += 5;
    if (info.imageLinks) score += 2;
    if (titleWords.length && titleWords.every((word) => source.has(word))) score += 15;
    return score;
  }

  async function fetchBooks(query) {
    const response = await fetch(
      "https://www.googleapis.com/books/v1/volumes?maxResults=20&langRestrict=he&q=" +
        encodeURIComponent(query),
    );
    if (!response.ok) throw new Error("HTTP " + response.status);
    const payload = await response.json();
    return Array.isArray(payload.items) ? payload.items : [];
  }

  async function recognizeCover() {
    const file = $("coverImage").files[0];
    if (!file) return setCoverMessage("צריך לבחור תמונה.", true);
    if (!window.Tesseract)
      return setCoverMessage("רכיב זיהוי התמונה לא נטען. בדוק את החיבור ורענן את הדף.", true);

    $("coverRecognize").disabled = true;
    $("coverSearch").disabled = true;
    setCoverMessage("מנתח את הכריכה ומחפש את הספר...");
    setProgress(1);

    try {
      const prepared = await prepareImage(file);
      const progressLogger = (event) => {
        if (event.status === "recognizing text")
          setProgress(Math.round((event.progress || 0) * 65));
      };
      const results = [];
      results.push(
        await Tesseract.recognize(prepared, "heb+eng", {
          logger: progressLogger,
          tessedit_pageseg_mode: "6",
          preserve_interword_spaces: "1",
        }),
      );
      results.push(
        await Tesseract.recognize(file, "heb+eng", {
          logger: progressLogger,
          tessedit_pageseg_mode: "11",
          preserve_interword_spaces: "1",
        }),
      );
      const best = chooseBestOcr(results);
      const text = best ? best.text : "";
      $("coverOcrText").value = text;
      if (!text) {
        setCoverMessage("לא זוהה טקסט ברור. אפשר להקליד את שם הספר ידנית.", true);
        return;
      }
      setProgress(70);
      await searchCoverBooks(true);
    } catch (error) {
      console.error("Cover recognition failed", error);
      setCoverMessage("זיהוי הכריכה נכשל. נסה צילום ישר וברור יותר, או הקלד את שם הספר ידנית.", true);
    } finally {
      $("coverRecognize").disabled = false;
      $("coverSearch").disabled = false;
      setProgress(null);
    }
  }

  async function searchCoverBooks(automatic = false) {
    const text = normalizeText($("coverOcrText").value);
    const queries = buildQueries(text);
    if (!queries.length) return setCoverMessage("צריך טקסט לחיפוש.", true);

    $("coverSearch").disabled = true;
    $("coverResults").innerHTML = "";
    setCoverMessage(automatic ? "הטקסט זוהה. מחפש את ההתאמה הטובה ביותר..." : "מחפש ספרים מתאימים...");

    try {
      const responses = await Promise.allSettled(queries.map(fetchBooks));
      const unique = new Map();
      responses.forEach((response) => {
        if (response.status !== "fulfilled") return;
        response.value.forEach((item) => {
          const info = item.volumeInfo || {};
          const key = item.id || [info.title, (info.authors || []).join("|")].join("|");
          if (!unique.has(key)) unique.set(key, item);
        });
      });
      lastCandidates = [...unique.values()]
        .map((item) => ({ item, score: scoreCandidate(item, text) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((entry) => entry.item);

      if (!lastCandidates.length)
        return setCoverMessage("לא נמצאו התאמות. תקן את הטקסט ונסה שוב.", true);

      $("coverResults").innerHTML = lastCandidates
        .map((item, index) => {
          const info = item.volumeInfo || {};
          const title = info.title || "ללא שם";
          const authors = Array.isArray(info.authors) ? info.authors.join(", ") : "";
          const cover = safeCover(info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail));
          return '<button type="button" class="result" data-cover-index="' + index + '">' +
            (cover ? '<img src="' + escapeHtml(cover) + '" alt="">' : '<span class="no-cover">ללא תמונה</span>') +
            '<span><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(authors) + '</small></span></button>';
        })
        .join("");

      $("coverResults").querySelectorAll("[data-cover-index]").forEach((button) => {
        button.onclick = () => selectCoverBook(lastCandidates[Number(button.dataset.coverIndex)]);
      });

      setCoverMessage("נמצאו " + lastCandidates.length + " התאמות, מסודרות לפי הסבירות. בחר את הספר הנכון.");
    } catch (error) {
      console.error("Cover search failed", error);
      setCoverMessage("החיפוש נכשל. בדוק את החיבור ונסה שוב.", true);
    } finally {
      $("coverSearch").disabled = false;
    }
  }

  function selectCoverBook(item) {
    const info = item.volumeInfo || {};
    $("coverTitle").value = (info.title || "") + (info.subtitle ? ": " + info.subtitle : "");
    $("coverAuthor").value = Array.isArray(info.authors) ? info.authors.join(", ") : "";
    selectedCover = safeCover(info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail));
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
    const duplicate = (duplicateData.data || []).find((book) =>
      String(book.title || "").toLowerCase().replace(/\s+/g, " ").trim() === normalizedTitle &&
      book.status !== "סל מחזור",
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
      return setCoverMessage("השמירה נכשלה: " + (error.message || "שגיאה לא ידועה"), true);
    setCoverMessage("הספר נשמר במדף החסר.");
    resetCover();
  }

  function injectCoverUi() {
    const appCard = $("appCard");
    if (!appCard || $("coverRecognizer")) return;
    const style = document.createElement("style");
    style.textContent =
      ".cover-tool{margin-top:18px;padding-top:18px;border-top:1px solid var(--line)}.cover-tool .preview{display:grid;grid-template-columns:110px 1fr;gap:14px;align-items:start}.cover-tool .preview img{width:110px;height:150px;object-fit:contain;background:#eee;border-radius:12px}.cover-tool .progress{height:9px;background:#ebe6dc;border-radius:99px;overflow:hidden;display:none;margin-top:10px}.cover-tool .progress span{display:block;height:100%;width:0;background:var(--green)}.cover-tool .results{display:grid;gap:8px;margin-top:12px}.cover-tool .result{display:grid;grid-template-columns:54px 1fr;gap:9px;align-items:center;background:white;border:1px solid var(--line);text-align:right;width:100%}.cover-tool .result img{width:54px;height:72px;object-fit:contain}.cover-tool .result span{display:grid;gap:4px}.cover-tool .result small{color:var(--muted)}.cover-tool .no-cover{font-size:11px;color:var(--muted);text-align:center}@media(max-width:520px){.cover-tool .preview{grid-template-columns:1fr}.cover-tool .preview img{width:100%;height:220px}}";
    document.head.appendChild(style);

    const section = document.createElement("section");
    section.id = "coverRecognizer";
    section.className = "cover-tool";
    section.innerHTML =
      '<h2>זיהוי ספר לפי תמונת כריכה</h2><p class="sub">צלם את הכריכה ישר ובתאורה טובה. המערכת קוראת את הטקסט, מחפשת בכמה צירופים ומדרגת את התוצאות.</p><div class="field"><label>צילום או בחירת תמונה</label><input id="coverImage" type="file" accept="image/*" capture="environment"></div><div class="preview"><img id="coverPreview" alt="תצוגת הכריכה"><div><div class="actions"><button id="coverRecognize" class="primary" type="button" disabled>זיהוי הספר</button><button id="coverReset" class="ghost" type="button">ניקוי</button></div><div id="coverProgress" class="progress"><span id="coverProgressBar"></span></div></div></div><div id="coverMessage" class="message" aria-live="polite"></div><div class="field"><label>טקסט שזוהה</label><textarea id="coverOcrText" placeholder="אפשר לתקן או להקליד כאן את שם הספר"></textarea></div><button id="coverSearch" class="primary" type="button">חיפוש מחדש</button><div id="coverResults" class="results"></div><div id="coverSaveArea" class="hidden"><div class="preview"><img id="selectedCover" alt="כריכת הספר"><div><div class="field"><label>שם הספר</label><input id="coverTitle"></div><div class="field"><label>שם המחבר</label><input id="coverAuthor"></div></div></div><div class="field"><label>הערות</label><textarea id="coverNotes"></textarea></div><div class="actions"><button id="coverSave" class="primary" type="button">שמירה במדף החסר</button><button id="coverCancel" class="ghost" type="button">ביטול</button></div></div>';
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
    $("coverSearch").onclick = () => searchCoverBooks(false);
    $("coverReset").onclick = resetCover;
    $("coverSave").onclick = saveCoverBook;
    $("coverCancel").onclick = () => $("coverSaveArea").classList.add("hidden");
  }

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function init() {
    injectCoverUi();
    loadTesseract().catch(() =>
      setCoverMessage("רכיב זיהוי התמונה לא נטען. אפשר עדיין להקליד שם ספר ולחפש.", true),
    );
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
