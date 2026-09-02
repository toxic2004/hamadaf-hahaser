"use strict";

const db = HamadafSupabase.createClient();
const $ = (id) => document.getElementById(id);
const TARGET_PRICE = 30;
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
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function reportCover(book) {
  const value = String(book.cover || "");
  if (value.startsWith("data:image/") || safeHttpUrl(value)) {
    return `<img class="reportCover" src="${escapeHtml(value)}" alt="כריכת ${escapeHtml(book.title)}" loading="lazy">`;
  }
  return `<div class="reportCover coverFallback">${escapeHtml(book.title)}</div>`;
}

function offerLink(offer) {
  const url = safeHttpUrl(offer.source_url);
  return url
    ? `<a class="button ghost" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">פתיחת מודעה</a>`
    : '<span class="sub">אין קישור</span>';
}

function rankingRow(offer, index) {
  const total = HamadafReport.totalPrice(offer);
  return `<div class="ranking">
    <span class="place">מקום ${index + 1}</span>
    <div><strong>${escapeHtml(offer.source)}</strong><br><span class="sub">ספר ${money(offer.item_price)}. משלוח ${money(offer.shipping_price || 0)}. ${escapeHtml(offer.condition || "")}</span></div>
    <span class="rankingPrice">${money(total)}</span>
    ${offerLink(offer)}
  </div>`;
}

function dealCard(item) {
  const bestTotal = HamadafReport.totalPrice(item.ranked[0]);
  const flags = [
    item.book.is_required ? "ספר חובה" : "",
    item.book.is_favorite ? "מועדף" : "",
    item.book.priority && item.book.priority !== "רגילה"
      ? `עדיפות ${item.book.priority}`
      : "",
  ].filter(Boolean);
  return `<article class="dealBook${item.withinTarget ? " target" : ""}">
    ${reportCover(item.book)}
    <div class="bookSummary">
      <h3>${escapeHtml(item.book.title)}</h3>
      <p class="sub">${escapeHtml(item.book.author || "מחבר לא צוין")}</p>
      <p><strong>${item.withinTarget ? "בתוך יעד 30 ₪" : `מעל היעד ב ${money(bestTotal - TARGET_PRICE)}`}</strong></p>
      <div class="bookFlags">${flags.map((flag) => `<span>${escapeHtml(flag)}</span>`).join("")}</div>
    </div>
    <div class="rankings">
      ${item.ranked.map(rankingRow).join("")}
      ${item.unknownShipping.length ? `<div class="unknownBox">${item.unknownShipping.length} הצעות נוספות עם משלוח לא ידוע. הן אינן משתתפות בדירוג.</div>` : ""}
      ${item.alternatives.length ? `<div class="alternativeBox">${item.alternatives.length} התאמות דומות מוצגות בנפרד ואינן מתחרות בהתאמות המדויקות.</div>` : ""}
    </div>
  </article>`;
}

function renderNoOffers(deals) {
  const rankedIds = new Set(deals.map((item) => item.book.id));
  const missing = books.filter((book) => !rankedIds.has(book.id));
  $("noOfferList").innerHTML = missing.length
    ? `<table><thead><tr><th>ספר</th><th>מחבר</th><th>הערה</th></tr></thead><tbody>${missing
        .map((book) => {
          const unknown = offers.filter(
            (offer) =>
              offer.book_id === book.id &&
              HamadafReport.totalPrice(offer) === null &&
              offer.active !== false,
          ).length;
          return `<tr><td><strong>${escapeHtml(book.title)}</strong></td><td>${escapeHtml(book.author || "")}</td><td>${unknown ? `${unknown} הצעות עם מחיר כולל לא ידוע` : "אין הצעה מדויקת פעילה"}</td></tr>`;
        })
        .join("")}</tbody></table>`
    : '<div class="emptyReport">לכל הספרים יש לפחות הצעה מדורגת אחת.</div>';
}

function renderReport() {
  const deals = HamadafReport.bestDeals(books, offers, TARGET_PRICE);
  const withinTarget = deals.filter((item) => item.withinTarget).length;
  $("bookMetric").textContent = String(books.length);
  $("dealMetric").textContent = String(withinTarget);
  $("reportMeta").textContent =
    "עודכן " + new Date().toLocaleString("he-IL");
  $("dealList").innerHTML = deals.length
    ? deals.map(dealCard).join("")
    : '<div class="emptyReport">אין כרגע הצעות עם מחיר כולל ידוע.</div>';
  renderNoOffers(deals);
}

function showError(message) {
  $("error").textContent = message;
  $("error").classList.remove("hidden");
}

async function loadData() {
  $("loading").classList.remove("hidden");
  $("error").classList.add("hidden");
  const [bookResult, offerResult] = await Promise.all([
    db
      .from("books")
      .select("*")
      .eq("user_id", user.id)
      .not("status", "in", '("השגתי","סל מחזור")')
      .order("priority", { ascending: false })
      .order("title"),
    db
      .from("price_offers")
      .select("*")
      .eq("user_id", user.id)
      .eq("active", true)
      .eq("is_removed", false),
  ]);
  $("loading").classList.add("hidden");
  const firstError = [bookResult, offerResult].find((result) => result.error);
  if (firstError) return showError("טעינת הדוח נכשלה.");
  books = bookResult.data || [];
  offers = offerResult.data || [];
  $("content").classList.remove("hidden");
  renderReport();
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
$("printReport").onclick = () => window.print();
db.auth.getSession().then(({ data }) => showSession(data.session));
db.auth.onAuthStateChange((event, session) => showSession(session));
