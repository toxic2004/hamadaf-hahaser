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

  async function acceptDetectedValue(value) {
    const detected = clean(value);
    if (!detected || detected === lastDecodedValue) return false;
    lastDecodedValue = detected;

    if (!valid(detected)) {
      scannerMessage(
        `זוהה ברקוד ${detected}, אך הוא אינו ISBN תקין. כוון לברקוד שמתחיל בדרך כלל ב־978 או 979.`,
      );
      return false;
    }

    scannerMessage(`נמצא ISBN ${detected}. מאתר את פרטי הספר...`);
    scanning = false;
    stopScanner();
    element("isbnScanner")?.classList.remove("open");
    element("isbn").value = detected;
    if (typeof window.lookupBook === "function") await window.lookupBook();
    return true;
  }

  async function acceptResult(result) {
    if (!result || !scanning) return;
    await acceptDetectedValue(result.getText());
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

  function chooseRearCamera(devices) {
    const videoDevices = devices.filter((device) => device.kind === "videoinput");
    const rearDevices = videoDevices.filter((device) =>
      /back|rear|environment|אחור/i.test(device.label || ""),
    );
    const preferred = rearDevices.find(
      (device) => !/ultra[ -]?wide|0\.5|front/i.test(device.label || ""),
    );
    return preferred || rearDevices[0] || videoDevices[videoDevices.length - 1] || null;
  }

  async function cameraConstraints() {
    let selected = null;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      selected = chooseRearCamera(devices);
    } catch (error) {
      console.warn("Could not enumerate cameras", error);
    }

    const video = {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    };
    if (selected?.deviceId) video.deviceId = { exact: selected.deviceId };
    return { audio: false, video };
  }

  function ensurePhotoFallback() {
    const dialog = element("isbnScanner")?.querySelector(".scannerDialog");
    if (!dialog || element("isbnPhotoInput")) return;

    const input = document.createElement("input");
    input.id = "isbnPhotoInput";
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.hidden = true;

    const button = document.createElement("button");
    button.id = "scanIsbnPhoto";
    button.type = "button";
    button.className = "ghost";
    button.textContent = "צילום ברקוד";
    button.style.width = "100%";
    button.style.marginTop = "10px";

    button.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      scannerMessage("מפענח את צילום הברקוד...");
      try {
        await ensureZxingLoaded();
        const reader = new window.ZXingBrowser.BrowserMultiFormatReader(
          scannerHints(),
        );
        const imageUrl = URL.createObjectURL(file);
        try {
          const result = await reader.decodeFromImageUrl(imageUrl);
          const accepted = await acceptDetectedValue(result.getText());
          if (!accepted) {
            scannerMessage(
              "הצילום נקרא, אך לא נמצא בו ISBN תקין. נסה לצלם רק את הברקוד כשהוא חד וממלא את רוב התמונה.",
            );
          }
        } finally {
          URL.revokeObjectURL(imageUrl);
        }
      } catch (error) {
        console.warn("ISBN photo decode failed", error);
        scannerMessage(
          "לא הצלחתי לקרוא את הברקוד מהצילום. נסה להתקרב מעט ולצלם כשהמספר והקווים חדים.",
        );
      } finally {
        input.value = "";
      }
    });

    dialog.append(input, button);
  }

  async function openScanner() {
    const modal = element("isbnScanner");
    const video = element("isbnVideo");
    modal.classList.add("open");
    ensurePhotoFallback();
    scannerMessage("מכין את רכיב הסריקה...");

    if (!navigator.mediaDevices?.getUserMedia) {
      scannerMessage("הדפדפן אינו מאפשר פתיחת מצלמה. אפשר להשתמש בצילום ברקוד.");
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
        await cameraConstraints(),
        video,
        (result) => {
          if (result) void acceptResult(result);
        },
      );
      if (!scanning) {
        nextControls?.stop();
        return;
      }
      controls = nextControls;
      scannerMessage(
        "המצלמה פעילה. מקם את כל הברקוד בתוך התמונה. אם אינו נקרא בתוך כמה שניות, לחץ על צילום ברקוד.",
      );
    } catch (error) {
      console.error("ISBN camera failed", error);
      stopScanner();
      scannerMessage(
        "המצלמה לא נפתחה. בדוק את הרשאת המצלמה או השתמש בצילום ברקוד.",
      );
    }
  }

  function init() {
    const modal = element("isbnScanner");
    ensurePhotoFallback();
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
    chooseRearCamera,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
