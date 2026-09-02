"use strict";

const db = HamadafSupabase.createClient();
const $ = (id) => document.getElementById(id);
let user;

function escapeHtml(value) {
  return String(value || "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function coverThumb(book) {
  const value = String(book.cover || "");
  if (value.startsWith("data:image/") || safeHttpUrl(value)) {
    return `<img class="statusThumb" src="${escapeHtml(value)}" alt="כריכת ${escapeHtml(book.title)}" loading="lazy">`;
  }
  return `<div class="statusThumb statusThumbFallback">${escapeHtml((book.title || "?").slice(0, 1))}</div>`;
}

function renderAcquired(list) {
  $("acquiredCount").textContent = String(list.length);
  $("acquiredList").innerHTML = list.length
    ? list
        .map(
          (book) =>
            `<div class="statusRow">${coverThumb(book)}<div><strong>${escapeHtml(book.title)}</strong><br><span class="sub">${escapeHtml(book.author || "מחבר לא צוין")}</span></div></div>`,
        )
        .join("")
    : '<div class="emptyReport">לא הועברו ספרים למצב השגתי ב-48 השעות האחרונות.</div>';
}

function showError(message) {
  $("error").textContent = message;
  $("error").classList.remove("hidden");
}

async function loadData() {
  $("loading").classList.remove("hidden");
  $("error").classList.add("hidden");
  const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const staleCutoff = new Date(
    Date.now() - 72 * 60 * 60 * 1000,
  ).toISOString();

  const [acquiredResult, photoCountResult, staleCountResult] =
    await Promise.all([
      db
        .from("books")
        .select("id,title,author,cover,acquired_at")
        .eq("user_id", user.id)
        .gte("acquired_at", since48h)
        .order("acquired_at", { ascending: false }),
      // added_via only exists on books added since 2026-09-02 - older
      // books were never tagged and are simply excluded, not counted
      // as "not via photo". This total is a running count from that
      // date forward, not a historical reconstruction.
      db
        .from("books")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("added_via", ["cover_photo", "isbn_scan"]),
      // "No update" covers every book regardless of status (מחפש,
      // בדיונים, השגתי, סל מחזור) and counts ANY field change
      // (including favorite/priority toggles), per what was confirmed.
      db
        .from("books")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .lt("updated_at", staleCutoff),
    ]);

  $("loading").classList.add("hidden");
  const firstError = [acquiredResult, photoCountResult, staleCountResult].find(
    (result) => result.error,
  );
  if (firstError) return showError("טעינת דוח המצב נכשלה.");

  renderAcquired(acquiredResult.data || []);
  $("photoCount").textContent = String(photoCountResult.count || 0);
  $("staleCount").textContent = String(staleCountResult.count || 0);
  $("content").classList.remove("hidden");
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
