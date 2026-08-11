"use strict";

const db = HamadafSupabase.createClient();
const $ = (id) => document.getElementById(id);
const TARGET_PRICE = 30;
const STATUS_LABELS = {
  pending: "ממתין לבדיקה",
  found: "נמצאה הצעה",
  not_found: "לא נמצאה תוצאה",
  login_required: "נדרשת כניסה",
  blocked: "המקור חסם גישה",
  temporary_error: "תקלה זמנית",
  unavailable: "המקור אינו זמין",
  manual_required: "נדרשת בדיקה ידנית",
};
let user;
let books = [];
let sources = [];
let offers = [];
let run = null;
let checks = [];

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

function sourceSearchUrl(source, book) {
  const title = book?.title || "ספרים";
  const author = book?.author || "";
  const query = encodeURIComponent(`${title} ${author}`.trim());
  const google = (scope) =>
    `https://www.google.com/search?q=${encodeURIComponent(`${scope} ${title} ${author}`.trim())}`;
  const direct = {
    yad2: "https://www.yad2.co.il/market/collections/books-media_books-and-magazines_books",
    simania: `https://simania.co.il/searchBooks.php?query=${query}`,
    facebook_marketplace: `https://www.facebook.com/marketplace/telaviv/search/?query=${query}`,
    facebook_public: `https://www.facebook.com/search/posts/?q=${query}`,
    evrit: `https://www.e-vrit.co.il/Search/${query}`,
    steimatzky: `https://www.steimatzky.co.il/catalogsearch/result/?q=${query}`,
    booknet: google("site:booknet.co.il"),
    sipur_hozer: google("site:sipurhozer.com"),
    rebooks: google("site:rebooks.org.il"),
    independent_and_general: google("ספר מודפס מחיר חנות ספרים"),
  };
  return direct[source.id] || google(source.label || "ספר");
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

function checkCountsForBook(bookId) {
  const bookChecks = checks.filter((check) => check.book_id === bookId);
  return HamadafReport.coverageSummary(bookChecks, sources.length);
}

function renderNoOffers(deals) {
  const rankedIds = new Set(deals.map((item) => item.book.id));
  const missing = books.filter((book) => !rankedIds.has(book.id));
  $("noOfferList").innerHTML = missing.length
    ? `<table><thead><tr><th>ספר</th><th>מחבר</th><th>כיסוי</th><th>הערה</th></tr></thead><tbody>${missing
        .map((book) => {
          const coverage = checkCountsForBook(book.id);
          const unknown = offers.filter(
            (offer) =>
              offer.book_id === book.id &&
              HamadafReport.totalPrice(offer) === null &&
              offer.active !== false,
          ).length;
          return `<tr><td><strong>${escapeHtml(book.title)}</strong></td><td>${escapeHtml(book.author || "")}</td><td>${coverage.completed} מתוך ${coverage.expected}</td><td>${unknown ? `${unknown} הצעות עם מחיר כולל לא ידוע` : "אין הצעה מדויקת פעילה"}</td></tr>`;
        })
        .join("")}</tbody></table>`
    : '<div class="emptyReport">לכל הספרים יש לפחות הצעה מדורגת אחת.</div>';
}

function renderMissingSources() {
  const problematic = new Set([
    "pending",
    "login_required",
    "blocked",
    "temporary_error",
    "unavailable",
    "manual_required",
  ]);
  const rows = sources
    .map((source) => {
      const sourceChecks = checks.filter(
        (check) =>
          check.source_id === source.id && problematic.has(check.status),
      );
      const counts = sourceChecks.reduce((result, check) => {
        result[check.status] = (result[check.status] || 0) + 1;
        return result;
      }, {});
      return { source, sourceChecks, counts };
    })
    .filter((item) => item.sourceChecks.length);
  $("missingSources").innerHTML = rows.length
    ? `<table><thead><tr><th>מקור</th><th>ספרים שהושפעו</th><th>פירוט</th></tr></thead><tbody>${rows
        .map(
          ({ source, sourceChecks, counts }) =>
            `<tr><td><strong>${escapeHtml(source.label)}</strong></td><td>${sourceChecks.length}</td><td>${Object.entries(
              counts,
            )
              .map(
                ([status, count]) =>
                  `${escapeHtml(STATUS_LABELS[status])}: ${count}`,
              )
              .join(". ")}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : '<div class="emptyReport">אין מקורות חסרים בריצה הזאת.</div>';
}

function renderCoverageEditor() {
  const book = books.find((item) => item.id === $("coverageBook").value);
  if (!run || !book) {
    $("coverageEditor").innerHTML =
      '<div class="emptyReport">פתח ריצת בדיקה מלאה כדי לתעד כל מקור.</div>';
    return;
  }
  const bySource = new Map(
    checks
      .filter((check) => check.book_id === book.id)
      .map((check) => [check.source_id, check]),
  );
  $("coverageEditor").innerHTML = sources
    .map((source) => {
      const check = bySource.get(source.id);
      if (!check) return "";
      return `<div class="coverageRow">
        <strong>${escapeHtml(source.label)}</strong>
        <select data-status="${check.id}" aria-label="סטטוס ${escapeHtml(source.label)}">${Object.entries(
          STATUS_LABELS,
        )
          .map(
            ([value, label]) =>
              `<option value="${value}"${check.status === value ? " selected" : ""}>${escapeHtml(label)}</option>`,
          )
          .join("")}</select>
        <input data-note="${check.id}" value="${escapeHtml(check.note || "")}" placeholder="הערה או סיבת כשל" />
        <a href="${escapeHtml(sourceSearchUrl(source, book))}" target="_blank" rel="noopener noreferrer">פתיחת חיפוש</a>
        <button class="primary" data-save-check="${check.id}">שמירה</button>
      </div>`;
    })
    .join("");
  document.querySelectorAll("[data-save-check]").forEach((button) => {
    button.onclick = () => saveCheck(button.dataset.saveCheck);
  });
}

function renderReport() {
  const expected = run?.expected_checks || books.length * sources.length;
  const coverage = HamadafReport.coverageSummary(checks, expected);
  const deals = HamadafReport.bestDeals(books, offers, TARGET_PRICE);
  const withinTarget = deals.filter((item) => item.withinTarget).length;
  $("coverageMetric").textContent = `${coverage.percent}%`;
  $("coverageDetail").textContent =
    `${coverage.completed} מתוך ${coverage.expected} בדיקות`;
  $("bookMetric").textContent = String(books.length);
  $("dealMetric").textContent = String(withinTarget);
  $("missingMetric").textContent = String(coverage.pending);
  $("reportMeta").textContent = run
    ? `${run.report_kind === "morning" ? "דוח בוקר" : run.report_kind === "evening" ? "דוח ערב" : "בדיקה ידנית"}. נפתח ${new Date(run.started_at).toLocaleString("he-IL")}`
    : "טרם נפתחה ריצת בדיקה מלאה";
  $("coverageBanner").classList.toggle("complete", coverage.complete);
  $("coverageBanner").innerHTML = coverage.complete
    ? `<strong>הכיסוי מלא.</strong> כל ${coverage.expected} בדיקות המקור קיבלו סטטוס מתועד.`
    : `<strong>הדוח בכיסוי חלקי.</strong> חסרות ${coverage.pending} בדיקות. הדוח אינו מסומן כמושלם עד שכל הספרים וכל המקורות יקבלו סטטוס.`;
  $("dealList").innerHTML = deals.length
    ? deals.map(dealCard).join("")
    : '<div class="emptyReport">אין כרגע הצעות עם מחיר כולל ידוע.</div>';
  renderNoOffers(deals);
  renderMissingSources();
  renderCoverageEditor();
}

async function saveCheck(id) {
  const status = document.querySelector(`[data-status="${id}"]`).value;
  const note = document.querySelector(`[data-note="${id}"]`).value.trim();
  const { error } = await db
    .from("report_checks")
    .update({
      status,
      note: note || null,
      checked_at: status === "pending" ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return showError("שמירת סטטוס המקור נכשלה.");
  await db.rpc("refresh_report_run", { target_run: run.id });
  await loadData();
}

async function startRun() {
  if (!books.length) return showError("אין ספרים פעילים לבדיקה.");
  $("startRun").disabled = true;
  $("startRun").textContent = "פותח ריצה...";
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
  const kind = hour < 14 ? "morning" : "evening";
  const { error } = await db.rpc("start_report_run", { target_kind: kind });
  $("startRun").disabled = false;
  $("startRun").textContent = "פתיחת ריצת בדיקה מלאה";
  if (error) return showError("פתיחת הריצה נכשלה. ודא שמיגרציית הדוח הופעלה.");
  await loadData();
}

function showError(message) {
  $("error").textContent = message;
  $("error").classList.remove("hidden");
}

async function loadData() {
  $("loading").classList.remove("hidden");
  $("error").classList.add("hidden");
  const [bookResult, sourceResult, offerResult, runResult] = await Promise.all([
    db
      .from("books")
      .select("*")
      .eq("user_id", user.id)
      .not("status", "in", '("השגתי","סל מחזור")')
      .order("priority", { ascending: false })
      .order("title"),
    db
      .from("report_sources")
      .select("*")
      .eq("active", true)
      .order("sort_order"),
    db
      .from("price_offers")
      .select("*")
      .eq("user_id", user.id)
      .eq("active", true)
      .eq("is_removed", false),
    db
      .from("report_runs")
      .select("*")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  $("loading").classList.add("hidden");
  const firstError = [bookResult, sourceResult, offerResult, runResult].find(
    (result) => result.error,
  );
  if (firstError)
    return showError("טעינת הדוח נכשלה. ודא שמיגרציית הדוח הופעלה.");
  books = bookResult.data || [];
  sources = sourceResult.data || [];
  offers = offerResult.data || [];
  run = runResult.data || null;
  checks = [];
  if (run) {
    const result = await db
      .from("report_checks")
      .select("*")
      .eq("user_id", user.id)
      .eq("run_id", run.id)
      .eq("scope_active", true)
      .order("created_at");
    if (result.error) return showError("טעינת בדיקות המקורות נכשלה.");
    checks = result.data || [];
  }
  const previousBook = $("coverageBook").value;
  $("coverageBook").innerHTML = books
    .map(
      (book) =>
        `<option value="${escapeHtml(book.id)}">${escapeHtml(book.title)}</option>`,
    )
    .join("");
  if (books.some((book) => book.id === previousBook))
    $("coverageBook").value = previousBook;
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
$("startRun").onclick = startRun;
$("printReport").onclick = () => window.print();
$("coverageBook").onchange = renderCoverageEditor;
db.auth.getSession().then(({ data }) => showSession(data.session));
db.auth.onAuthStateChange((event, session) => showSession(session));
