"use strict";

const db = HamadafSupabase.createClient();
const $ = (id) => document.getElementById(id);
let user;
let books = [];
let chart;

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
  return value === null || value === undefined
    ? "חסר מידע"
    : new Intl.NumberFormat("he-IL", {
        style: "currency",
        currency: "ILS",
      }).format(Number(value));
}
function metric(label, value, note = "") {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}
function httpUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

async function loadHistory() {
  const bookId = $("bookSelect").value;
  if (!bookId) return;
  $("loading").classList.remove("hidden");
  $("content").classList.add("hidden");
  const cutoff = new Date(Date.now() - 365 * 86400000)
    .toISOString()
    .slice(0, 10);
  const [dailyResult, removedResult] = await Promise.all([
    db
      .from("daily_book_prices")
      .select("*")
      .eq("book_id", bookId)
      .gte("captured_on", cutoff)
      .order("captured_on", { ascending: true }),
    db
      .from("price_history")
      .select("*")
      .eq("book_id", bookId)
      .eq("is_removed", true)
      .gte("captured_on", cutoff)
      .order("captured_on", { ascending: false }),
  ]);
  $("loading").classList.add("hidden");
  if (dailyResult.error || removedResult.error) {
    $("error").textContent =
      "טעינת ההיסטוריה נכשלה. ודא שמיגרציית המחירים הופעלה.";
    $("error").classList.remove("hidden");
    return;
  }
  const daily = dailyResult.data || [];
  const removed = removedResult.data || [];
  const book = books.find((item) => item.id === bookId);
  const priced = daily.filter((entry) => entry.total_price !== null);
  const minimum = priced.length
    ? Math.min(...priced.map((entry) => Number(entry.total_price)))
    : null;
  const latest = priced.length ? priced[priced.length - 1] : null;
  $("metrics").innerHTML = [
    metric(
      "מחיר מינימום",
      money(minimum),
      priced.length ? "מתוך התיעוד היומי" : "אין מחיר כולל מתועד",
    ),
    metric(
      "מחיר אחרון",
      money(latest?.total_price),
      latest
        ? new Date(latest.captured_on).toLocaleDateString("he-IL")
        : "אין תיעוד",
    ),
    metric(
      "מחיר ששולם בפועל",
      money(book?.purchase_price),
      book?.purchase_price === null ? "אפשר להזין בעריכת הספר" : "נשמר בספר",
    ),
    metric("ימים מתועדים", daily.length),
  ].join("");
  chart?.destroy();
  chart = new Chart($("historyChart"), {
    type: "line",
    data: {
      labels: daily.map((entry) =>
        new Date(entry.captured_on).toLocaleDateString("he-IL"),
      ),
      datasets: [
        {
          label: "מחיר כולל",
          data: daily.map((entry) => entry.total_price),
          borderColor: "#285f50",
          backgroundColor: "rgba(40,95,80,.14)",
          fill: true,
          tension: 0.2,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: false } },
      plugins: { legend: { rtl: true } },
    },
  });
  $("removedOffers").innerHTML = removed.length
    ? removed
        .map((entry) => {
          const safeUrl = httpUrl(entry.source_url);
          const imageUrl = httpUrl(entry.ad_image_url);
          return `<article class="offer">${imageUrl ? `<img class="offerImage" src="${escapeHtml(imageUrl)}" alt="תמונת המודעה שהוסרה" loading="lazy">` : ""}<strong>${escapeHtml(entry.source)}</strong><p>${money(entry.total_price)} · ${new Date(entry.captured_on).toLocaleDateString("he-IL")}</p><p>${escapeHtml(entry.seller_name || "מוכר לא ידוע")}</p>${safeUrl ? `<a class="button ghost" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">קישור שנשמר</a>` : ""}</article>`;
        })
        .join("")
    : '<div class="notice">אין מודעות שהוסרו בתיעוד.</div>';
  $("historyTable").innerHTML =
    `<thead><tr><th>תאריך</th><th>מקור</th><th>ספר</th><th>משלוח</th><th>כולל</th><th>מצב</th><th>מיקום</th><th>מוכר</th></tr></thead><tbody>${daily.map((entry) => `<tr><td>${new Date(entry.captured_on).toLocaleDateString("he-IL")}</td><td>${escapeHtml(entry.source)}</td><td>${money(entry.item_price)}</td><td>${money(entry.shipping_price)}</td><td>${money(entry.total_price)}</td><td>${escapeHtml(entry.condition || "")}</td><td>${escapeHtml(entry.location || "")}</td><td>${escapeHtml(entry.seller_name || "")}</td></tr>`).join("")}</tbody>`;
  $("historyTable")
    .querySelectorAll("th,td")
    .forEach((cell) => {
      cell.style.padding = "9px";
      cell.style.borderBottom = "1px solid var(--line)";
      cell.style.textAlign = "right";
    });
  $("content").classList.remove("hidden");
}

async function loadBooks() {
  const { data, error } = await db
    .from("books")
    .select("id,title,purchase_price")
    .order("title");
  if (error) {
    $("loading").classList.add("hidden");
    $("error").textContent =
      "טעינת הספרים נכשלה. ודא שהחיבור זמין ושמיגרציות הנתונים הופעלו.";
    $("error").classList.remove("hidden");
    return;
  }
  books = data || [];
  if (!books.length) {
    $("loading").classList.add("hidden");
    $("error").textContent = "אין עדיין ספרים להצגת היסטוריית מחירים.";
    $("error").classList.remove("hidden");
    return;
  }
  $("bookSelect").innerHTML = books
    .map(
      (book) => `<option value="${book.id}">${escapeHtml(book.title)}</option>`,
    )
    .join("");
  loadHistory();
}
function showSession(session) {
  user = session?.user || null;
  $("authCard").classList.toggle("hidden", Boolean(user));
  $("app").classList.toggle("hidden", !user);
  if (user) loadBooks();
}
$("login").onclick = async () => {
  const { data, error } = await db.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  $("authMessage").textContent = error ? "הכניסה נכשלה. בדוק את הפרטים." : "";
  if (!error) showSession(data.session);
};
$("bookSelect").onchange = loadHistory;
db.auth.getSession().then(({ data }) => showSession(data.session));
db.auth.onAuthStateChange((event, session) => showSession(session));
