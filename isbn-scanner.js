(function () {
  "use strict";

  let controls = null;
  let scanning = false;

  const element = (id) => document.getElementById(id);

  function scannerMessage(text) {
    const message = element("scannerMessage");
    if (message) message.textContent = text;
  }

  function clean(value) {
    return window.HamadafIsbn
      ? window.HamadafIsbn.clean(value)
      : String(value || "")
          .toUpperCase()
          .replace(/[^0-9X]/g, "");
  }

  function valid(value) {
    return Boolean(window.HamadafIsbn?.isValidIsbn(value));
  }

  function stopScanner() {
    if (controls) {
      controls.stop();
      controls = null;
    }
    const video = element("isbnVideo");
    if (video?.srcObject) {
      video.srcObject.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
    scanning = false;
  }

  function closeScanner() {
    stopScanner();
    element("isbnScanner")?.classList.remove("open");
  }

  async function acceptResult(result) {
    if (!result || !scanning) return;
    const isbn = clean(result.getText());
    if (!valid(isbn)) return;
    scanning = false;
    stopScanner();
    element("isbnScanner")?.classList.remove("open");
    element("isbn").value = isbn;
    if (typeof window.lookupBook === "function") await window.lookupBook();
  }

  async function openScanner() {
    const modal = element("isbnScanner");
    const video = element("isbnVideo");
    modal.classList.add("open");
    scannerMessage("פותח את המצלמה...");

    if (!navigator.mediaDevices?.getUserMedia) {
      scannerMessage("הדפדפן אינו מאפשר פתיחת מצלמה. אפשר להזין ISBN ידנית.");
      return;
    }
    if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
      scannerMessage("רכיב הסריקה לא נטען. אפשר להזין ISBN ידנית.");
      return;
    }

    stopScanner();
    scanning = true;
    try {
      const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
      const nextControls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        video,
        (result) => {
          if (result) acceptResult(result);
        },
      );
      if (!scanning) {
        nextControls?.stop();
        return;
      }
      controls = nextControls;
      scannerMessage("המצלמה פעילה. החזק את הברקוד יציב בתוך התמונה.");
    } catch (error) {
      console.error("ISBN camera failed", error);
      stopScanner();
      scannerMessage(
        "המצלמה לא נפתחה. בדוק את הרשאת המצלמה או הזן ISBN ידנית.",
      );
    }
  }

  function init() {
    const modal = element("isbnScanner");
    element("scanIsbn")?.addEventListener("click", openScanner);
    element("closeScanner")?.addEventListener("click", closeScanner);
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) closeScanner();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) closeScanner();
    });
    window.addEventListener("pagehide", stopScanner);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
