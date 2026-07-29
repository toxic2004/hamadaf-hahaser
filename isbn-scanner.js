(function () {
  "use strict";

  const ZXING_URLS = [
    "https://unpkg.com/@zxing/browser@0.2.1",
    "https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1",
  ];

  let controls = null;
  let scanning = false;
  let zxingLoadPromise = null;
  let lastDecodedValue = "";

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

  function hasZxing() {
    return Boolean(window.ZXingBrowser?.BrowserMultiFormatReader);
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.dataset.hamadafZxing = "true";
      script.onload = () => {
        if (hasZxing()) resolve();
        else {
          script.remove();
          reject(new Error("ZXing loaded without BrowserMultiFormatReader"));
        }
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("ZXing CDN failed: " + url));
      };
      document.head.appendChild(script);
    });
  }

  async function ensureZxingLoaded() {
    if (hasZxing()) return;
    if (!zxingLoadPromise) {
      zxingLoadPromise = (async () => {
        let lastError = null;
        for (const url of ZXING_URLS) {
          try {
            await loadScript(url);
            return;
          } catch (error) {
            lastError = error;
            console.warn("ISBN scanner CDN failed", url, error);
          }
        }
        throw lastError || new Error("ZXing could not be loaded");
      })().catch((error) => {
        zxingLoadPromise = null;
        throw error;
      });
    }
    await zxingLoadPromise;
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
    lastDecodedValue = "";
  }

  function closeScanner() {
    stopScanner();
    element("isbnScanner")?.classList.remove("open");
  }

  async function acceptResult(result) {
    if (!result || !scanning) return;
    const detected = clean(result.getText());
    if (!detected || detected === lastDecodedValue) return;
    lastDecodedValue = detected;

    if (!valid(detected)) {
      scannerMessage(
        `זוהה ברקוד ${detected}, אך הוא אינו ISBN תקין. כוון לברקוד שמתחיל בדרך כלל ב־978 או 979.`,
      );
      return;
    }

    scannerMessage(`נמצא ISBN ${detected}. מאתר את פרטי הספר...`);
    scanning = false;
    stopScanner();
    element("isbnScanner")?.classList.remove("open");
    element("isbn").value = detected;
    if (typeof window.lookupBook === "function") await window.lookupBook();
  }

  function scannerHints() {
    const api = window.ZXingBrowser;
    if (!api?.DecodeHintType || !api?.BarcodeFormat) return undefined;
    const hints = new Map();
    const formats = [
      api.BarcodeFormat.EAN_13,
      api.BarcodeFormat.EAN_8,
      api.BarcodeFormat.UPC_A,
      api.BarcodeFormat.UPC_E,
      api.BarcodeFormat.CODE_128,
    ].filter((format) => format !== undefined);
    if (formats.length) {
      hints.set(api.DecodeHintType.POSSIBLE_FORMATS, formats);
    }
    hints.set(api.DecodeHintType.TRY_HARDER, true);
    return hints;
  }

  function isRoutineDecodeMiss(error) {
    const name = String(error?.name || error?.constructor?.name || "");
    return /NotFoundException|ChecksumException|FormatException/.test(name);
  }

  async function openScanner() {
    const modal = element("isbnScanner");
    const video = element("isbnVideo");
    modal.classList.add("open");
    scannerMessage("מכין את רכיב הסריקה...");

    if (!navigator.mediaDevices?.getUserMedia) {
      scannerMessage("הדפדפן אינו מאפשר פתיחת מצלמה. אפשר להזין ISBN ידנית.");
      return;
    }

    try {
      await ensureZxingLoaded();
    } catch (error) {
      console.error("ISBN scanner library failed", error);
      scannerMessage(
        "רכיב הסריקה לא נטען. בדוק את החיבור, רענן את הדף ונסה שוב.",
      );
      return;
    }

    stopScanner();
    scanning = true;
    lastDecodedValue = "";
    scannerMessage("פותח את המצלמה...");
    try {
      const reader = new window.ZXingBrowser.BrowserMultiFormatReader(
        scannerHints(),
        250,
      );
      const nextControls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        video,
        (result, error) => {
          if (result) {
            void acceptResult(result);
            return;
          }
          if (error && !isRoutineDecodeMiss(error)) {
            console.warn("ISBN decode warning", error);
            scannerMessage(
              "המצלמה פעילה אך הפענוח נתקל בבעיה. נסה להרחיק מעט את הספר ולשפר את התאורה.",
            );
          }
        },
      );
      if (!scanning) {
        nextControls?.stop();
        return;
      }
      controls = nextControls;
      scannerMessage(
        "המצלמה פעילה. מקם את כל הברקוד בתוך התמונה, החזק יציב ושמור מרחק של כ־15–25 ס״מ.",
      );
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

  window.HamadafIsbnScanner = {
    ensureZxingLoaded,
    hasZxing,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
