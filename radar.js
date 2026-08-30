"use strict";

const db = HamadafSupabase.createClient();
const $ = (id) => document.getElementById(id);
let user;
let books = [];
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

function offerRow(offer) {
  const isActive = offer.status === "פעילה";
  const isPurchased = offer.status === "נקנתה";
  const shipping =
    offer.shipping_price === null || offer.shipping_price === undefined
      ? "משלוח: לא ידוע"
      : `משלוח: ${money(offer.shipping_price)}`;
  const total =
    offer.shipping_price === null || offer.shipping_price === undefined
      ? ""
      : `<strong> · סה"כ: ${money(Number(offer.item_price) + Number(offer.shipping_price))}</strong>`;
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
    ? `<button class="ghost" data-purchase="${offer.id}">קניתי</button>`
    : "";
  return `<div class="radarOffer${isActive ? "" : " muted"}${isPurchased ? " purchased" : ""}">
    <p><strong>${money(offer.item_price)}</strong> · ${shipping}${total}</p>
    <p class="sub">${contact}${pickup}</p>
    <p class="sub">הוזן ${formatDate(offer.entered_at)} · ${escapeHtml(offer.status)}</p>
    ${purchasedNote}
    ${button}
  </div>`;
}

function bookCard(book, bookOffers) {
  const sorted = [...bookOffers].sort(
    (a, b) => Number(a.item_price) - Number(b.item_price),
  );
  return `<article class="panel radarCard">
    <h2>${escapeHtml(book.title)}</h2>
    ${book.author ? `<p class="sub">${escapeHtml(book.author)}</p>` : ""}
    ${sorted.map(offerRow).join("")}
  </article>`;
}

function render() {
  const offersByBook = new Map();
  for (const offer of offers) {
    if (!offersByBook.has(offer.book_id)) offersByBook.set(offer.book_id, []);
    offersByBook.get(offer.book_id).push(offer);
  }
  // Only books that already have at least one manual offer get a card -
  // showing an empty card for every 'מחפש' book (dozens of them) would
  // bury the ones that actually need attention.
  const cards = books
    .filter((book) => offersByBook.has(book.id))
    .map((book) => bookCard(book, offersByBook.get(book.id)))
    .join("");
  $("radarCards").innerHTML =
    cards ||
    '<div class="notice">אין עדיין הצעות ברדאר. הצעות שתשלח לקלוד יופיעו כאן.</div>';
  document.querySelectorAll("[data-purchase]").forEach((button) => {
    button.onclick = () => purchaseOffer(button.dataset.purchase);
  });
}

async function purchaseOffer(offerId) {
  const offer = offers.find((item) => item.id === offerId);
  if (!offer) return;
  const priceInput = prompt(
    "מחיר הרכישה בפועל (₪):",
    String(offer.item_price ?? ""),
  );
  if (priceInput === null) return;
  const price = Number(priceInput);
  if (!Number.isFinite(price) || price < 0) {
    showError("מחיר הרכישה חייב להיות מספר תקין.");
    return;
  }
  const from = prompt("ממי נקנה? (אופציונלי)", offer.seller_name || "") || null;
  clearError();
  const { error } = await db.rpc("mark_manual_offer_purchased", {
    p_offer_id: offerId,
    p_purchased_price: price,
    p_purchased_from: from,
  });
  if (error) {
    showError("סימון הרכישה נכשל. נסה שוב.");
    return;
  }
  await loadData();
}

async function loadData() {
  $("loading").classList.remove("hidden");
  const [bookResult, offerResult] = await Promise.all([
    db
      .from("books")
      .select("id,title,author,status")
      .eq("user_id", user.id)
      .eq("status", "מחפש")
      .order("title"),
    db
      .from("manual_offers")
      .select("*")
      .eq("user_id", user.id)
      .order("item_price", { ascending: true }),
  ]);
  $("loading").classList.add("hidden");
  if (bookResult.error || offerResult.error) {
    showError("טעינת הנתונים נכשלה.");
    return;
  }
  books = bookResult.data || [];
  offers = offerResult.data || [];
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
db.auth.getSession().then(({ data }) => showSession(data.session));
db.auth.onAuthStateChange((event, session) => showSession(session));

const AUTO_REFRESH_MS = 90000;
setInterval(() => {
  if (user && document.visibilityState === "visible") loadData();
}, AUTO_REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (user && document.visibilityState === "visible") loadData();
});
