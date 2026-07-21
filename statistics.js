"use strict";

const db = HamadafSupabase.createClient();
const $ = (id) => document.getElementById(id);
let books = [];
let statusChart;
let activityChart;

function money(value) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

function metric(label, value, note = "") {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function render() {
  const stats = HamadafStatistics.calculateStatistics(books, $("period").value);
  const labels = {
    מחפש: "מחפש",
    בדיונים: "משא ומתן",
    "מחכה לתשובה": "מחכה לתשובה",
    השגתי: "הושג",
    "סל מחזור": "סל מחזור",
  };
  $("metrics").innerHTML = [
    ...Object.entries(stats.statusCounts).map(([status, count]) =>
      metric(labels[status], count),
    ),
    metric("נוספו החודש", stats.addedThisMonth),
    metric(
      "נקנו החודש",
      stats.boughtThisMonth,
      "נספרים רק ספרים עם תאריך השגה",
    ),
    metric(
      "הוצאות בפועל",
      stats.expenses === null ? "חסר מידע" : money(stats.expenses),
      stats.expenseCoverage
        ? `מבוסס על ${stats.expenseCoverage} ספרים`
        : "לא הוזנו מחירי רכישה",
    ),
    metric(
      "חיסכון מול חדש",
      stats.savings === null ? "חסר מידע" : money(stats.savings),
      stats.savingsCoverage
        ? `מבוסס על ${stats.savingsCoverage} ספרים עם שני המחירים`
        : "נדרשים מחיר רכישה ומחיר חדש",
    ),
    metric(
      "זמן ממוצע להשגה",
      stats.averageDays === null
        ? "חסר מידע"
        : `${stats.averageDays.toFixed(1)} ימים`,
      stats.averageCoverage
        ? `מבוסס על ${stats.averageCoverage} ספרים`
        : "נדרשים תאריכי הוספה והשגה",
    ),
  ].join("");

  const statusNames = Object.keys(stats.statusCounts);
  statusChart?.destroy();
  statusChart = new Chart($("statusChart"), {
    type: "doughnut",
    data: {
      labels: statusNames.map((status) => labels[status]),
      datasets: [
        {
          data: statusNames.map((status) => stats.statusCounts[status]),
          backgroundColor: [
            "#285f50",
            "#c7903b",
            "#7f8faa",
            "#6c985e",
            "#a66f69",
          ],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", rtl: true } },
    },
  });

  const months = [];
  const base = new Date();
  for (let offset = 11; offset >= 0; offset -= 1)
    months.push(new Date(base.getFullYear(), base.getMonth() - offset, 1));
  activityChart?.destroy();
  activityChart = new Chart($("activityChart"), {
    type: "bar",
    data: {
      labels: months.map((date) =>
        date.toLocaleDateString("he-IL", { month: "short", year: "2-digit" }),
      ),
      datasets: [
        {
          label: "נוספו",
          data: months.map(
            (month) =>
              books.filter(
                (book) =>
                  dateValue(book.created_at) &&
                  monthKey(dateValue(book.created_at)) === monthKey(month),
              ).length,
          ),
          backgroundColor: "#285f50",
        },
        {
          label: "הושגו",
          data: months.map(
            (month) =>
              books.filter(
                (book) =>
                  dateValue(book.acquired_at) &&
                  monthKey(dateValue(book.acquired_at)) === monthKey(month),
              ).length,
          ),
          backgroundColor: "#c7903b",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { position: "bottom", rtl: true } },
    },
  });

  $("missingSummary").textContent = stats.missing.length
    ? `${stats.missing.length} ספרים דורשים השלמת מידע`
    : "לא נמצאו פרטים חסרים";
  $("missingList").innerHTML = stats.missing.length
    ? stats.missing
        .slice(0, 100)
        .map(
          (book) =>
            `<li><strong>${escapeHtml(book.title)}</strong><br><span class="muted">חסר: ${book.fields.join(", ")}</span></li>`,
        )
        .join("")
    : "<li>כל הספרים הפעילים כוללים מחבר, ISBN וכריכה.</li>";
  $("qualityNotes").innerHTML =
    [
      stats.expenses === null &&
        "<p>הוצאות אינן מוצגות כסכום אפס משום שלא קיימים מחירי רכישה.</p>",
      stats.savings === null &&
        "<p>חיסכון אינו מחושב ללא מחיר ששולם ומחיר חדש לאותו ספר.</p>",
      stats.averageDays === null &&
        "<p>זמן השגה ממוצע אינו מחושב ללא תאריך השגה.</p>",
    ]
      .filter(Boolean)
      .join("") || "<p>המדדים המחושבים כוללים את נתוני המקור הדרושים.</p>";
}

function escapeHtml(value) {
  return String(value || "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}

async function loadBooks() {
  $("loading").classList.remove("hidden");
  $("error").classList.add("hidden");
  const { data, error } = await db
    .from("books")
    .select("*")
    .order("created_at", { ascending: true });
  $("loading").classList.add("hidden");
  if (error) {
    $("error").textContent =
      "טעינת הסטטיסטיקות נכשלה. ודא שמיגרציות הנתונים הופעלו ונסה שוב.";
    $("error").classList.remove("hidden");
    return;
  }
  books = data || [];
  $("content").classList.remove("hidden");
  render();
}

function showSession(session) {
  const signedIn = Boolean(session?.user);
  $("authCard").classList.toggle("hidden", signedIn);
  $("app").classList.toggle("hidden", !signedIn);
  if (signedIn) loadBooks();
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
$("period").onchange = render;
$("print").onclick = () => window.print();
db.auth.getSession().then(({ data }) => showSession(data.session));
db.auth.onAuthStateChange((event, session) => showSession(session));
