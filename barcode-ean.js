(function () {
  "use strict";

  const QUAGGA_URLS = [
    "https://unpkg.com/@ericblade/quagga2@1.12.1/dist/quagga.min.js",
    "https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.12.1/dist/quagga.min.js",
  ];
  let quaggaLoadPromise = null;

  const element = (id) => document.getElementById(id);
  const digits = (value) => String(value || "").replace(/\D/g, "");
  const isRegularBarcode = (value) => /^\d{8,14}$/.test(digits(value));
  const isIsbn = (value) => Boolean(window.HamadafIsbn?.isValidIsbn(value));

  function scannerMessage(text) {
    const target = element("scannerMessage");
    if (target) target.textContent = text;
  }

  function pageMessage(text, error = false) {
    const target = element("message");
    if (!target) return;
    target.textContent = text;
    target.className = "message" + (error ? " error" : "");
    target.style.display = text ? "block" : "none";
  }

  function hasQuagga() {
    return Boolean(window.Quagga?.decodeSingle);
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.dataset.hamadafQuagga = "true";
      script.onload = () => {
        if (hasQuagga()) resolve();
        else reject(new Error("Quagga loaded without decodeSingle"));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("Quagga CDN failed: " + url));
      };
      document.head.appendChild(script);
    });
  }

  async function ensureQuaggaLoaded() {
    if (hasQuagga()) return;
    if (!quaggaLoadPromise) {
      quaggaLoadPromise = (async () => {
        let lastError = null;
        for (const url of QUAGGA_URLS) {
          try {
            await loadScript(url);
            return;
          } catch (error) {
            lastError = error;
            console.warn("EAN scanner CDN failed", url, error);
          }
        }
        throw lastError || new Error("Quagga could not be loaded");
      })().catch((error) => {
        quaggaLoadPromise = null;
        throw error;
      });
    }
    await quaggaLoadPromise;
  }

  function decodeImage(url) {
    return new Promise((resolve, reject) => {
      window.Quagga.decodeSingle(
        {
          src: url,
          numOfWorkers: 0,
          locate: true,
          inputStream: { size: 1600, singleChannel: false },
          locator: { patchSize: "medium", halfSample: false },
          decoder: {
            readers: [
              "ean_reader",
              "ean_8_reader",
              "upc_reader",
              "upc_e_reader",
              "code_128_reader",
            ],
          },
        },
        (result) => {
          const code = digits(result?.codeResult?.code);
          if (isRegularBarcode(code)) resolve(code);
          else reject(new Error("No supported EAN barcode found"));
        },
      );
    });
  }

  async function acceptBarcode(code) {
    const normalized = digits(code);
    if (!isRegularBarcode(normalized)) {
      scannerMessage("לא זוהה ברקוד מספרי תקין. נסה צילום חד יותר.");
      return;
    }

    element("isbn").value = normalized;
    element("isbnScanner")?.classList.remove("open");
    window.HamadafIsbnScanner?.stop?.();

    if (isIsbn(normalized) && typeof window.lookupBook === "function") {
      pageMessage(`זוהה ISBN ${normalized}. מחפש את פרטי הספר...`);
      await window.lookupBook();
      return;
    }

    element("form")?.classList.remove("hidden");
    pageMessage(
      `זוהה ברקוד EAN ${normalized}. הוא אינו ISBN תקין, לכן יש להזין את שם הספר והמחבר ידנית. הברקוד יישמר עם הספר.`,
    );
    element("title")?.focus();
  }

  function installScannerButton() {
    const dialog = element("isbnScanner")?.querySelector(".scannerDialog");
    if (!dialog || element("scanRegularBarcode")) return;

    const input = document.createElement("input");
    input.id = "regularBarcodePhoto";
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.hidden = true;

    const button = document.createElement("button");
    button.id = "scanRegularBarcode";
    button.type = "button";
    button.className = "primary";
    button.textContent = "סריקת ברקוד רגיל";
    button.style.width = "100%";
    button.style.marginTop = "10px";
    button.addEventListener("click", () => input.click());

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      scannerMessage("מפענח ברקוד EAN מהצילום...");
      const imageUrl = URL.createObjectURL(file);
      try {
        await ensureQuaggaLoaded();
        const code = await decodeImage(imageUrl);
        await acceptBarcode(code);
      } catch (error) {
        console.warn("EAN photo decode failed", error);
        scannerMessage(
          "לא הצלחתי לקרוא את הברקוד. צלם רק את הברקוד והמספר, כשהם ישרים, חדים וממלאים את רוב התמונה.",
        );
      } finally {
        URL.revokeObjectURL(imageUrl);
        input.value = "";
      }
    });

    dialog.append(input, button);
  }

  async function saveRegularBarcode(event) {
    const code = digits(element("isbn")?.value);
    if (!isRegularBarcode(code) || isIsbn(code)) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const title = element("title")?.value.trim();
    if (!title) {
      pageMessage("צריך להזין שם ספר.", true);
      return;
    }

    const db = window.HamadafSupabase?.createClient();
    if (!db) {
      pageMessage("לא ניתן להתחבר למסד הנתונים כרגע.", true);
      return;
    }

    const { data: sessionData } = await db.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) {
      pageMessage("צריך להתחבר מחדש.", true);
      return;
    }

    const saveButton = element("save");
    saveButton.disabled = true;
    saveButton.textContent = "שומר...";

    try {
      const { data: books, error: duplicateError } = await db
        .from("books")
        .select("id,title,notes,status,isbn")
        .eq("user_id", user.id);
      if (duplicateError) throw duplicateError;
      const duplicate = (books || []).find((book) => {
        if (book.status === "סל מחזור") return false;
        if (digits(book.isbn) === code) return true;
        return new RegExp(`\\[BARCODE:${code}\\]`, "i").test(book.notes || "");
      });
      if (duplicate) {
        pageMessage("הספר כבר קיים ברשימה: " + duplicate.title, true);
        return;
      }

      const visibleNotes = element("notes")?.value.trim() || "";
      const notes =
        (visibleNotes ? visibleNotes + "\n" : "") + `[BARCODE:${code}]`;
      const now = new Date().toISOString();
      const row = {
        id: crypto.randomUUID(),
        user_id: user.id,
        title,
        author: element("author")?.value.trim() || "",
        cover: element("cover")?.getAttribute("src") || "",
        notes,
        status: "מחפש",
        created_at: now,
        updated_at: now,
      };
      const { error } = await db.from("books").insert(row);
      if (error) throw error;
      pageMessage(`הספר נשמר עם ברקוד EAN ${code}.`);
      setTimeout(() => {
        window.location.href = "./";
      }, 700);
    } catch (error) {
      console.error("Regular barcode save failed", error);
      pageMessage("השמירה נכשלה. הנתונים לא נמחקו, נסה שוב.", true);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "שמירה במדף החסר";
    }
  }

  function init() {
    installScannerButton();
    element("save")?.addEventListener("click", saveRegularBarcode, true);
  }

  window.HamadafEanScanner = {
    ensureQuaggaLoaded,
    isRegularBarcode,
    acceptBarcode,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
