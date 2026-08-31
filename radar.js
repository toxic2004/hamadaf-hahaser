"use strict";

const db = HamadafSupabase.createClient();
const $ = (id) => document.getElementById(id);
let user;
let activeBooks = [];
let archivedBooks = [];
let offers = [];

function escapeHtml(value) {
  return String(value || "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}

function money(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("he-IL", {
        style: "currency",
        currency: "ILS",
      }).format(number)
    : null;
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function showError(message) {
  $("error").textContent = message;
  $("error").classList.remove("hidden");
}

function clearError() {
  $("error").textContent = "";
  $("error").classList.add("hidden");
}

function coverHtml(book) {
  return book.cover
    ? `<img class="radarCover" src="${escapeHtml(book.cover)}" alt="${escapeHtml(book.title)}" loading="lazy">`
    : `<div class="radarCover radarCoverFallback">${escapeHtml((book.title || "").trim().split(/\s+/)[0]?.slice(0, 6) || "")}</div>`;
}

// Inline purchase form instead of window.prompt(): chained prompt()
// dialogs are unreliable across mobile Safari contexts and give no visual
// confirmation that anything happened - exactly the kind of silent
// failure that looked like "nothing is synced" from the outside.
function purchaseFormHtml(offer) {
  return `<div class="purchaseForm" data-purchase-form="${offer.id}">
    <div class="field">
      <label>מחיר הרכישה בפועל</label>
      <input type="number" min="0" step="0.01" class="purchasePrice" value="${escapeHtml(offer.item_price ?? "")}">
    </div>
    <div class="field">
      <label>ממי נקנה (אופציונלי)</label>
      <input type="text" class="purchaseFrom" value="${escapeHtml(offer.seller_name || "")}">
    </div>
    <div class="purchaseFormActions">
      <button class="primary" data-confirm-purchase="${offer.id}">אישור קנייה</button>
      <button class="ghost" data-cancel-purchase="${offer.id}">ביטול</button>
    </div>
    <p class="sub purchaseFormMessage" aria-live="polite"></p>
  </div>`;
}

function offerRow(offer) {
  const isPurchased = offer.status === "נקנתה";
  const shippingKnown =
    offer.shipping_price !== null && offer.shipping_price !== undefined;
  const shipping = shippingKnown
    ? `משלוח: ${money(offer.shipping_price)}`
    : "משלוח: לא ידוע";
  const total = shippingKnown
    ? `<strong> · סה"כ: ${money(Number(offer.item_price) + Number(offer.shipping_price))}</strong>`
    : "";
  const contact = [offer.seller_name, offer.phone]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
  const pickup = offer.pickup_location
    ? ` · איסוף: ${escapeHtml(offer.pickup_location)}`
    : "";
  const purchasedNote = isPurchased
    ? `<p class="sub">נקנה ${formatDate(offer.purchased_at)}${offer.purchased_from ? " מ" + escapeHtml(offer.purchased_from) : ""} ב${money(offer.purchased_price) || "לא ידוע"}</p>`
    : "";
  return `<div class="radarOffer${offer.status !== "פעילה" ? " muted" : ""}${isPurchased ? " purchased" : ""}" data-offer-id="${offer.id}">
    <p><strong>${money(offer.item_price)}</strong> · ${shipping}${total}</p>
    <p class="sub">${contact}${pickup}</p>
    <p class="sub">הוזן ${formatDate(offer.entered_at)} · ${escapeHtml(offer.status)}</p>
    ${purchasedNote}
  </div>`;
}

// One book = one purchase, even when several sellers are competing for
// it - a "קניתי" button per offer implied buying every offer separately,
// which isn't the intent. This renders exactly one buy control per card:
// straight to the purchase form when there's only one active offer to
// pick from, or a small seller picker first when there's more than one.
function buyControlHtml(book, activeOffers) {
  if (!activeOffers.length) return "";
  if (activeOffers.length === 1) {
    return `<div class="radarBuyWrap" data-buy-wrap="${book.id}">
      <button class="radarBuyButton" data-start-purchase="${activeOffers[0].id}">✓ קניתי</button>
    </div>`;
  }
  const options = activeOffers
    .map(
      (offer) =>
        `<option value="${offer.id}">${escapeHtml(offer.seller_name || "מוכר")} - ${money(offer.item_price)}</option>`,
    )
    .join("");
  return `<div class="radarBuyWrap" data-buy-wrap="${book.id}">
    <button class="radarBuyButton" data-open-picker="${book.id}">✓ קניתי</button>
    <div class="offerPicker hidden" data-offer-picker="${book.id}">
      <label>מאיזו הצעה קנית?</label>
      <select class="offerPickerSelect">${options}</select>
      <button class="ghost" data-confirm-picker="${book.id}">המשך</button>
    </div>
  </div>`;
}

function bookCard(book, bookOffers, isArchived) {
  const sorted = [...bookOffers].sort(
    (a, b) => Number(a.item_price) - Number(b.item_price),
  );
  const activeOffers = sorted.filter((offer) => offer.status === "פעילה");
  return `<article class="panel radarCard${isArchived ? " archived" : ""}">
    <div class="radarCardHead">
      ${coverHtml(book)}
      <div>
        <h2>${escapeHtml(book.title)}</h2>
        ${book.author ? `<p class="sub">${escapeHtml(book.author)}</p>` : ""}
        ${isArchived ? '<span class="badge">נרכש</span>' : ""}
      </div>
    </div>
    ${sorted.map(offerRow).join("")}
    ${isArchived ? "" : buyControlHtml(book, activeOffers)}
  </article>`;
}

function startPurchaseFor(offerId, container) {
  const offer = offers.find((item) => item.id === offerId);
  if (!offer) return;
  if (container.querySelector(".purchaseForm")) return;
  container.insertAdjacentHTML("beforeend", purchaseFormHtml(offer));
  bindPurchaseFormActions(container);
}

function bindOfferActions() {
  document.querySelectorAll("[data-start-purchase]").forEach((button) => {
    button.onclick = () => {
      const wrap = button.closest(".radarBuyWrap");
      startPurchaseFor(button.dataset.startPurchase, wrap);
    };
  });
  document.querySelectorAll("[data-open-picker]").forEach((button) => {
    button.onclick = () => {
      const wrap = button.closest(".radarBuyWrap");
      wrap.querySelector(".offerPicker")?.classList.remove("hidden");
      button.classList.add("hidden");
    };
  });
  document.querySelectorAll("[data-confirm-picker]").forEach((button) => {
    button.onclick = () => {
      const wrap = button.closest(".radarBuyWrap");
      const offerId = wrap.querySelector(".offerPickerSelect").value;
      wrap.querySelector(".offerPicker")?.remove();
      startPurchaseFor(offerId, wrap);
    };
  });
}

function bindPurchaseFormActions(scope) {
  scope.querySelectorAll("[data-confirm-purchase]").forEach((button) => {
    button.onclick = () => confirmPurchase(button.dataset.confirmPurchase);
  });
  scope.querySelectorAll("[data-cancel-purchase]").forEach((button) => {
    button.onclick = () => {
      button.closest(".purchaseForm")?.remove();
    };
  });
}

async function confirmPurchase(offerId) {
  const form = document.querySelector(`[data-purchase-form="${offerId}"]`);
  if (!form) return;
  const priceValue = form.querySelector(".purchasePrice").value;
  const fromValue = form.querySelector(".purchaseFrom").value.trim() || null;
  const message = form.querySelector(".purchaseFormMessage");
  const price = Number(priceValue);
  if (!Number.isFinite(price) || price < 0) {
    message.textContent = "מחיר הרכישה חייב להיות מספר תקין.";
    return;
  }
  message.textContent = "שומר...";
  const { error } = await db.rpc("mark_manual_offer_purchased", {
    p_offer_id: offerId,
    p_purchased_price: price,
    p_purchased_from: fromValue,
  });
  if (error) {
    message.textContent = "הסימון נכשל. נסה שוב.";
    return;
  }
  clearError();
  await loadData();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // reader.result is "data:image/png;base64,AAAA..." - strip the prefix.
      const commaIndex = reader.result.indexOf(",");
      resolve(reader.result.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function confidenceBadge(confidence) {
  if (confidence === "high") return "";
  const label = confidence === "low" ? "התאמה לא ודאית" : "לא זוהתה התאמה";
  return `<p class="ingestWarning">⚠️ ${label} - בדוק ובחר את הספר הנכון</p>`;
}

function bookOptionsHtml(selectedId) {
  return activeBooks
    .map(
      (book) =>
        `<option value="${book.id}"${book.id === selectedId ? " selected" : ""}>${escapeHtml(book.title)}</option>`,
    )
    .join("");
}

function ingestCardHtml(candidate, index) {
  const bundleNote = candidate.bundle_note
    ? `<p class="ingestWarning">⚠️ ${escapeHtml(candidate.bundle_note)}</p>`
    : "";
  return `<div class="panel ingestCard" data-ingest-card="${index}">
    ${confidenceBadge(candidate.confidence)}
    ${bundleNote}
    <div class="field">
      <label>ספר</label>
      <select class="ingestBook">
        <option value="">- בחר ספר -</option>
        ${bookOptionsHtml(candidate.book_id)}
      </select>
      ${candidate.matched_title ? `<p class="sub">קלוד זיהה: ${escapeHtml(candidate.matched_title)}</p>` : ""}
    </div>
    <div class="field">
      <label>מחיר (חובה - לא ניתן לשמור בלי מחיר)</label>
      <input type="number" min="0" step="0.01" class="ingestPrice" value="${candidate.item_price ?? ""}">
    </div>
    <div class="field">
      <label>מוכר</label>
      <input type="text" class="ingestSeller" value="${escapeHtml(candidate.seller_name || "")}">
    </div>
    <div class="field">
      <label>טלפון</label>
      <input type="text" class="ingestPhone" value="${escapeHtml(candidate.phone || "")}">
    </div>
    <div class="field">
      <label>משלוח (אם ידוע)</label>
      <input type="number" min="0" step="0.01" class="ingestShipping" value="${candidate.shipping_price ?? ""}">
    </div>
    <div class="field">
      <label>מיקום איסוף</label>
      <input type="text" class="ingestPickup" value="${escapeHtml(candidate.pickup_location || "")}">
    </div>
    <div class="purchaseFormActions">
      <button class="primary" data-save-ingest="${index}">שמור הצעה</button>
      <button class="ghost" data-dismiss-ingest="${index}">התעלם</button>
    </div>
    <p class="sub ingestCardMessage" aria-live="polite"></p>
  </div>`;
}

let pendingIngestCandidates = [];

function renderIngestResults() {
  $("ingestResults").innerHTML = pendingIngestCandidates
    .map((candidate, index) =>
      candidate ? ingestCardHtml(candidate, index) : "",
    )
    .join("");
  bindIngestActions();
}

function bindIngestActions() {
  document.querySelectorAll("[data-dismiss-ingest]").forEach((button) => {
    button.onclick = () => {
      pendingIngestCandidates[Number(button.dataset.dismissIngest)] = null;
      renderIngestResults();
    };
  });
  document.querySelectorAll("[data-save-ingest]").forEach((button) => {
    button.onclick = () =>
      saveIngestCandidate(Number(button.dataset.saveIngest));
  });
}

async function saveIngestCandidate(index) {
  const card = document.querySelector(`[data-ingest-card="${index}"]`);
  if (!card) return;
  const message = card.querySelector(".ingestCardMessage");
  const bookId = card.querySelector(".ingestBook").value;
  const priceValue = card.querySelector(".ingestPrice").value;
  const shippingValue = card.querySelector(".ingestShipping").value;
  if (!bookId) {
    message.textContent = "יש לבחור ספר לפני השמירה.";
    return;
  }
  const price = Number(priceValue);
  if (!Number.isFinite(price) || price < 0 || priceValue === "") {
    message.textContent = "מחיר הוא שדה חובה ולא יכול להישאר ריק.";
    return;
  }
  message.textContent = "שומר...";
  const { error } = await db.from("manual_offers").insert({
    user_id: user.id,
    book_id: bookId,
    seller_name: card.querySelector(".ingestSeller").value.trim() || null,
    phone: card.querySelector(".ingestPhone").value.trim() || null,
    item_price: price,
    shipping_price: shippingValue === "" ? null : Number(shippingValue),
    pickup_location: card.querySelector(".ingestPickup").value.trim() || null,
    source_note: "נוסף דרך העלאת תמונה ברדאר המדף.",
    status: "פעילה",
  });
  if (error) {
    message.textContent = "השמירה נכשלה. נסה שוב.";
    return;
  }
  pendingIngestCandidates[index] = null;
  renderIngestResults();
  await loadData();
}

$("ingestFile").onchange = async () => {
  const file = $("ingestFile").files[0];
  if (!file) return;
  $("ingestStatus").textContent = "מנתח תמונה...";
  $("ingestResults").innerHTML = "";
  pendingIngestCandidates = [];
  try {
    const imageBase64 = await fileToBase64(file);
    const { data, error } = await db.functions.invoke("radar-image-ingest", {
      body: { image_base64: imageBase64, media_type: file.type },
    });
    if (error || !data?.ok) {
      $("ingestStatus").textContent =
        "הניתוח נכשל. נסה שוב או שלח את התמונה לקלוד בצ'אט הרגיל.";
      return;
    }
    if (!data.books?.length) {
      $("ingestStatus").textContent = "לא זוהה בתמונה ספר מרשימת החיפוש שלך.";
      return;
    }
    $("ingestStatus").textContent =
      `זוהו ${data.books.length} הצעות אפשריות - בדוק ואשר כל אחת לפני שמירה.`;
    pendingIngestCandidates = data.books;
    renderIngestResults();
  } catch {
    $("ingestStatus").textContent = "הניתוח נכשל. נסה שוב.";
  } finally {
    $("ingestFile").value = "";
  }
};

function render() {
  const offersByBook = new Map();
  for (const offer of offers) {
    if (!offersByBook.has(offer.book_id)) offersByBook.set(offer.book_id, []);
    offersByBook.get(offer.book_id).push(offer);
  }
  const activeCards = activeBooks
    .filter((book) => offersByBook.has(book.id))
    .map((book) => bookCard(book, offersByBook.get(book.id), false))
    .join("");
  $("radarCards").innerHTML =
    activeCards ||
    '<div class="notice">אין עדיין הצעות ברדאר. הצעות שתשלח לקלוד יופיעו כאן.</div>';

  const archivedCards = archivedBooks
    .map((book) => bookCard(book, offersByBook.get(book.id) || [], true))
    .join("");
  $("radarArchive").innerHTML =
    archivedCards ||
    '<div class="notice">אין עדיין ספרים שנרכשו דרך הרדאר.</div>';
  $("archiveToggle").classList.toggle("hidden", archivedBooks.length === 0);

  bindOfferActions();
}

async function loadData() {
  $("loading").classList.remove("hidden");
  const [bookResult, offerResult] = await Promise.all([
    db
      .from("books")
      .select("id,title,author,status,cover")
      .eq("user_id", user.id)
      .eq("status", "מחפש")
      .order("title"),
    db
      .from("manual_offers")
      .select("*")
      .eq("user_id", user.id)
      .order("item_price", { ascending: true }),
  ]);
  if (bookResult.error || offerResult.error) {
    $("loading").classList.add("hidden");
    showError("טעינת הנתונים נכשלה.");
    return;
  }
  activeBooks = bookResult.data || [];
  offers = offerResult.data || [];

  // Books that had a manual offer marked 'נקנתה' but are no longer in the
  // active ('מחפש') list above - they moved to 'השגתי' via the purchase
  // RPC. Fetched separately (by id, no status filter) so their history
  // stays visible in an archive section instead of just disappearing.
  const activeIds = new Set(activeBooks.map((book) => book.id));
  const purchasedBookIds = [
    ...new Set(
      offers
        .filter((offer) => offer.status === "נקנתה")
        .map((offer) => offer.book_id)
        .filter((id) => !activeIds.has(id)),
    ),
  ];
  if (purchasedBookIds.length) {
    const archiveResult = await db
      .from("books")
      .select("id,title,author,status,cover")
      .in("id", purchasedBookIds);
    archivedBooks = archiveResult.data || [];
  } else {
    archivedBooks = [];
  }

  $("loading").classList.add("hidden");
  $("content").classList.remove("hidden");
  render();
}

function showSession(session) {
  user = session?.user || null;
  $("authCard").classList.toggle("hidden", Boolean(user));
  $("app").classList.toggle("hidden", !user);
  if (user) loadData();
}

$("login").onclick = async () => {
  $("authMessage").textContent = "מתחבר...";
  const { data, error } = await db.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  $("authMessage").textContent = error ? "הכניסה נכשלה. בדוק את הפרטים." : "";
  if (!error) showSession(data.session);
};
$("archiveToggle").onclick = () => {
  $("radarArchive").classList.toggle("hidden");
  $("archiveToggle").textContent = $("radarArchive").classList.contains(
    "hidden",
  )
    ? "הצג ספרים שנרכשו"
    : "הסתר ספרים שנרכשו";
};
db.auth.getSession().then(({ data }) => showSession(data.session));
db.auth.onAuthStateChange((event, session) => showSession(session));

const AUTO_REFRESH_MS = 90000;
setInterval(() => {
  if (user && document.visibilityState === "visible") loadData();
}, AUTO_REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (user && document.visibilityState === "visible") loadData();
});
