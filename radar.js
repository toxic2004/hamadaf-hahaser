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
  const isActive = offer.status === "פעילה";
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
  const button = isActive
    ? `<button class="ghost" data-start-purchase="${offer.id}">קניתי</button>`
    : "";
  return `<div class="radarOffer${isActive ? "" : " muted"}${isPurchased ? " purchased" : ""}" data-offer-id="${offer.id}">
    <p><strong>${money(offer.item_price)}</strong> · ${shipping}${total}</p>
    <p class="sub">${contact}${pickup}</p>
    <p class="sub">הוזן ${formatDate(offer.entered_at)} · ${escapeHtml(offer.status)}</p>
    ${purchasedNote}
    ${button}
  </div>`;
}

function bookCard(book, bookOffers, isArchived) {
  const sorted = [...bookOffers].sort(
    (a, b) => Number(a.item_price) - Number(b.item_price),
  );
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
  </article>`;
}

function bindOfferActions() {
  document.querySelectorAll("[data-start-purchase]").forEach((button) => {
    button.onclick = () => {
      const offer = offers.find(
        (item) => item.id === button.dataset.startPurchase,
      );
      if (!offer) return;
      const row = button.closest(".radarOffer");
      if (row.querySelector(".purchaseForm")) return;
      row.insertAdjacentHTML("beforeend", purchaseFormHtml(offer));
      bindPurchaseFormActions(row);
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
