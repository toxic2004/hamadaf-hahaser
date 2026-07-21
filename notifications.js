"use strict";

const db = HamadafSupabase.createClient();
const $ = (id) => document.getElementById(id);
let user;
let notifications = [];

function escapeHtml(value) {
  return String(value || "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}

function renderNotifications() {
  const unread = notifications.filter((item) => !item.read_at).length;
  $("notificationCount").textContent =
    `${unread} לא נקראו מתוך ${notifications.length}`;
  $("notificationList").innerHTML = notifications.length
    ? notifications
        .map(
          (item) =>
            `<article class="offer${item.read_at ? "" : " best"}"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p><p class="sub">${new Date(item.created_at).toLocaleString("he-IL")} · ${escapeHtml(item.notification_type)}</p>${item.read_at ? "" : `<button class="ghost" data-read="${item.id}">סימון כנקרא</button>`}</article>`,
        )
        .join("")
    : '<div class="notice">אין התראות עדיין.</div>';
  document
    .querySelectorAll("[data-read]")
    .forEach(
      (button) => (button.onclick = () => markRead(button.dataset.read)),
    );
}

async function loadNotifications() {
  const { data, error } = await db
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error)
    return showError("טעינת ההתראות נכשלה. ודא שמיגרציית המחירים הופעלה.");
  notifications = data || [];
  renderNotifications();
}

async function loadSettings() {
  const { data, error } = await db
    .from("notification_settings")
    .select("*")
    .maybeSingle();
  if (error) return showError("טעינת הגדרות ההתראה נכשלה.");
  $("threshold").value = data?.immediate_deal_threshold ?? 70;
  $("emailEnabled").checked = Boolean(data?.email_enabled);
  $("notificationEmail").value = data?.email_address || user.email || "";
}

async function saveSettings() {
  const threshold = Number($("threshold").value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    $("settingsMessage").textContent = "הסף חייב להיות בין 0 ל 100.";
    return;
  }
  if ($("emailEnabled").checked && !$("notificationEmail").value.trim()) {
    $("settingsMessage").textContent = "צריך להזין כתובת מייל.";
    return;
  }
  const { error } = await db.from("notification_settings").upsert({
    user_id: user.id,
    timezone: "Asia/Jerusalem",
    morning_report_hour: 7,
    evening_check_hour: 19,
    immediate_deal_threshold: threshold,
    email_enabled: $("emailEnabled").checked,
    email_address: $("notificationEmail").value.trim() || null,
    updated_at: new Date().toISOString(),
  });
  $("settingsMessage").textContent = error
    ? "שמירת ההגדרות נכשלה."
    : "ההגדרות נשמרו.";
}

async function markRead(id) {
  const { error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return showError("סימון ההתראה נכשל.");
  await loadNotifications();
}

async function markAllRead() {
  const { error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) return showError("סימון ההתראות נכשל.");
  await loadNotifications();
}

function showError(message) {
  $("error").textContent = message;
  $("error").classList.remove("hidden");
}

async function loadData() {
  await Promise.all([loadSettings(), loadNotifications()]);
}

function showSession(session) {
  user = session?.user || null;
  $("authCard").classList.toggle("hidden", Boolean(user));
  $("app").classList.toggle("hidden", !user);
  if (user) loadData();
}

$("login").onclick = async () => {
  const { data, error } = await db.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  $("authMessage").textContent = error ? "הכניסה נכשלה. בדוק את הפרטים." : "";
  if (!error) showSession(data.session);
};
$("saveSettings").onclick = saveSettings;
$("markAllRead").onclick = markAllRead;
db.auth.getSession().then(({ data }) => showSession(data.session));
db.auth.onAuthStateChange((event, session) => showSession(session));
