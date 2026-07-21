const INITIAL = [
  "הסוד",
  "חשוב והתעשר",
  "הנזיר שמכר את הפרארי שלו",
  "כוח בלתי מוגבל",
  "הרגלים אטומיים",
  "חוק החמש שניות",
  "להעיר את הענק שבפנים",
  "היה הגיבור של חייך",
  "מועדון ה 5 בבוקר",
  "להשיג הכול",
  "אבא עשיר אבא עני",
  "האיש העשיר ביותר בבבל",
  "הפסיכולוגיה של הכסף",
  "אשליית הכסף",
  "מיליונר ברגע",
  "סודות של מיליונרים",
  "DotCom Secrets",
  "מאפס לאחד",
  "The 10X Rule",
  "עקרון 80/20",
  "השקעות לעצלנים",
  "Deep Work",
  "4 שעות עבודה בשבוע",
  "לגרום לדברים לקרות",
  "כוחו של הרגל",
  "סדר את המיטה שלך",
  "גריט",
  "No Excuses",
  "Clear Thinking",
  "שבעת ההרגלים של אנשים אפקטיביים",
  "100 דברים שאנשים מצליחים עושים",
  "כיצד לרכוש ידידים והשפעה",
  "מוקף באידיוטים",
  "כוח. 48 החוקים",
  "ארבע ההסכמות",
  "ההסכמה החמישית",
  "האומץ להעז",
  "מי הזיז את הגבינה שלי",
  "כך מקבלים החלטה",
  "השפעה. הפסיכולוגיה של השכנוע",
  "האדם מחפש משמעות",
  "כוחו של הרגע הזה",
  "האלכימאי",
  "כוחו של התת מודע",
  "לשבור את ההרגל להיות עצמכם",
  "The Happiness Advantage",
  "מהרס עצמי לערך עצמי",
  "לחשוב מהר לחשוב לאט",
  "כשהדברים מתפרקים",
  "לממש את הטוב שבך",
  "חוכמת האדישות",
  "החיים שתמיד רצית",
  "אהבה",
  "מהפכת המשמעות",
  "הפסיכולוגיה של האושר",
  "אל תאמינו לכל מה שאתם חושבים",
  "איינשטיין בזמן ובמרחב",
  "להזמין מציאות",
  "כוחה של שיחה",
  "כוחו של מיקוד",
  "ליצור מציאות",
  "הקרבות הגדולים",
  "אנושות 2.0",
  "לא נשוב אחור",
];
const KEY = "hamadaf-hahaser-v1";
const SUPABASE_URL = "https://mfxhmnzyfhlaiqctchvb.supabase.co";
const SUPABASE_KEY = "sb_publishable_joNTfIdJZ1t34wsl1S_d3g_aWmhHdaB";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const state = {
  books: [],
  status: "מחפש",
  view: "grid",
  selected: null,
  user: null,
  coverTarget: null,
};
const subtitles = {
  מחפש: "הספרים שאני מחפש",
  בדיונים: "ספרים שנמצאים בדיונים או במשא ומתן",
  השגתי: "ספרים שכבר השגתי",
  "סל מחזור": "ספרים שהוסרו מהרשימה",
};
async function init() {
  const saved = localStorage.getItem(KEY);
  state.books = saved
    ? JSON.parse(saved)
    : INITIAL.map((title, i) => ({
        id: crypto.randomUUID(),
        title,
        author: "",
        cover: "",
        notes: "",
        status: "מחפש",
        created: Date.now() - i,
      }));
  bind();
  render();
  const { data } = await db.auth.getSession();
  if (data.session) await connected(data.session.user);
  db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session) connected(session.user);
    if (event === "SIGNED_OUT") disconnected();
  });
}
function bind() {
  search.oninput = render;
  sort.onchange = render;
  view.onclick = () => {
    state.view = state.view === "grid" ? "list" : "grid";
    view.textContent = state.view === "grid" ? "☷ רשימה" : "▦ כרטיסיות";
    render();
  };
  exportExcel.onclick = exportToExcel;
  add.onclick = openAdd;
  document
    .querySelectorAll(".nav")
    .forEach((n) => (n.onclick = () => changePage(n)));
  document.querySelectorAll(".close").forEach(
    (b) =>
      (b.onclick = () => {
        b.closest(".overlay").classList.remove("open");
        unlockScroll();
      }),
  );
  cancel.onclick = () => {
    modal.classList.remove("open");
    unlockScroll();
  };
  save.onclick = saveBook;
  lookup.onclick = findBook;
  image.onchange = loadImage;
  signIn.onclick = login;
  signUp.onclick = register;
  signOut.onclick = () => db.auth.signOut();
  [modal, detailModal, coverSearchModal].forEach(
    (m) =>
      (m.onclick = (e) => {
        if (e.target === m) {
          m.classList.remove("open");
          unlockScroll();
        }
      }),
  );
  document.addEventListener("click", captureCoverChoice, true);
  unlockScroll();
}
function unlockScroll() {
  document.documentElement.style.setProperty("overflow-y", "auto", "important");
  document.body.style.setProperty("overflow-y", "auto", "important");
  document.body.style.setProperty("position", "static", "important");
  document.body.style.removeProperty("height");
}
async function exportToExcel() {
  if (!state.books.length) return toast("אין ספרים לייצוא");
  if (typeof XLSX === "undefined")
    return toast("רכיב הייצוא עדיין לא נטען. נסה שוב בעוד רגע");
  const headers = [
    "שם הספר",
    "שם המחבר",
    "מצב",
    "הערות",
    "תאריך הוספה",
    "קיימת כריכה",
  ];
  const rows = [
    headers,
    ...[...state.books]
      .sort((a, b) => b.created - a.created)
      .map((b) => [
        b.title,
        b.author,
        b.status,
        b.notes,
        new Date(b.created).toLocaleDateString("he-IL"),
        b.cover ? "כן" : "לא",
      ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 34 },
    { wch: 28 },
    { wch: 14 },
    { wch: 42 },
    { wch: 16 },
    { wch: 14 },
  ];
  sheet["!autofilter"] = { ref: "A1:F" + rows.length };
  const book = XLSX.utils.book_new();
  book.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(book, sheet, "הספרים שלי");
  const bytes = XLSX.write(book, { bookType: "xlsx", type: "array" });
  const name = "המדף החסר " + new Date().toISOString().slice(0, 10) + ".xlsx";
  const file = new File([bytes], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  if (
    /iPhone|iPad|iPod/.test(navigator.userAgent) &&
    navigator.canShare &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title: "המדף החסר" });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast("קובץ Excel בעברית ירד למכשיר");
}
async function login() {
  const email = authEmail.value.trim(),
    password = authPassword.value;
  if (!email || !password)
    return (authMessage.textContent = "צריך להזין אימייל וסיסמה");
  authMessage.textContent = "מתחבר...";
  const { error } = await db.auth.signInWithPassword({ email, password });
  authMessage.textContent = error
    ? "הכניסה נכשלה. בדוק את האימייל והסיסמה."
    : "";
}
async function register() {
  const email = authEmail.value.trim(),
    password = authPassword.value;
  if (!email || password.length < 6)
    return (authMessage.textContent = "צריך אימייל וסיסמה של לפחות 6 תווים");
  authMessage.textContent = "יוצר חשבון...";
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error)
    return (authMessage.textContent = "יצירת החשבון נכשלה: " + error.message);
  authMessage.textContent = data.session
    ? "החשבון נוצר בהצלחה"
    : "נשלח אליך אימייל אישור. אשר אותו ואז לחץ על כניסה.";
}
async function connected(user) {
  state.user = user;
  authModal.classList.remove("open");
  signOut.style.display = "inline-block";
  syncText.textContent = "מסונכרן לחשבון " + user.email;
  await loadRemote();
}
function disconnected() {
  state.user = null;
  signOut.style.display = "none";
  syncText.textContent = "לא מחובר";
  authModal.classList.add("open");
}
function rowToBook(r) {
  return {
    id: r.id,
    title: r.title,
    author: r.author || "",
    cover: r.cover || "",
    notes: r.notes || "",
    status: r.status,
    created: new Date(r.created_at).getTime(),
  };
}
function bookToRow(b) {
  return {
    id: b.id,
    user_id: state.user.id,
    title: b.title,
    author: b.author || "",
    cover: b.cover || "",
    notes: b.notes || "",
    status: b.status,
    created_at: new Date(b.created).toISOString(),
    updated_at: new Date().toISOString(),
  };
}
async function loadRemote() {
  syncText.textContent = "מסנכרן...";
  const { data, error } = await db
    .from("books")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    syncText.textContent = "שגיאת סנכרון";
    return toast("לא ניתן לטעון את הספרים");
  }
  if (!data.length && state.books.length) {
    const { error: migrateError } = await db
      .from("books")
      .upsert(state.books.map(bookToRow));
    if (migrateError) {
      syncText.textContent = "שגיאת סנכרון";
      return toast("העברת הרשימה לענן נכשלה");
    }
  } else {
    state.books = data.map(rowToBook);
  }
  await removeOpenLibraryData();
  persist();
  render();
  syncText.textContent = "מסונכרן לחשבון " + state.user.email;
}
async function removeOpenLibraryData() {
  const affected = state.books.filter((b) =>
    /^https:\/\/covers\.openlibrary\.org\//.test(b.cover || ""),
  );
  if (!affected.length) return;
  syncText.textContent = "מסיר כריכות לא מתאימות...";
  for (const b of affected) {
    b.cover = "";
    b.author = "";
    await db
      .from("books")
      .update({
        cover: "",
        author: "",
        updated_at: new Date().toISOString(),
      })
      .eq("id", b.id);
  }
  toast("הכריכות הלא מתאימות הוסרו");
}
function openGoogleImages(title, target = "form") {
  state.coverTarget = target;
  coverSearchModal.classList.add("open");
  runCoverSearch('"' + title + '"');
}
function runCoverSearch(query, tries = 0) {
  const element =
    window.google &&
    google.search &&
    google.search.cse &&
    google.search.cse.element &&
    google.search.cse.element.getElement("covers");
  if (element) return element.execute(query);
  if (tries < 30) setTimeout(() => runCoverSearch(query, tries + 1), 250);
  else toast("מנוע החיפוש עדיין לא נטען");
}
function captureCoverChoice(e) {
  const img =
    e.target.closest &&
    e.target.closest(
      "#coverSearchModal .gsc-imageResult img, #coverSearchModal img.gs-image",
    );
  if (!img) return;
  e.preventDefault();
  e.stopPropagation();
  const src = img.dataset.src || img.currentSrc || img.src;
  if (src) selectCover(src);
}
async function selectCover(src) {
  toast("מעתיק את הכריכה...");
  const stored = await importCover(src);
  if (!stored) return toast("לא ניתן להעתיק את התמונה הזאת. בחר כריכה אחרת");
  if (state.coverTarget === "form") {
    coverData.value = stored;
    showPreview(stored);
    coverSearchModal.classList.remove("open");
    unlockScroll();
    return toast("הכריכה נבחרה. לחץ שמירה");
  }
  const b = state.books.find((x) => x.id === state.coverTarget);
  if (!b) return;
  b.cover = stored;
  const { error } = await db
    .from("books")
    .update({ cover: stored, updated_at: new Date().toISOString() })
    .eq("id", b.id);
  if (error) {
    b.cover = "";
    return toast("שמירת הכריכה נכשלה");
  }
  persist();
  render();
  coverSearchModal.classList.remove("open");
  unlockScroll();
  toast("הכריכה הועתקה, נשמרה וסונכרנה");
}
async function importCover(src) {
  try {
    const r = await fetch(src, { mode: "cors" });
    if (!r.ok) throw new Error();
    const blob = await r.blob();
    if (!blob.type.startsWith("image/")) throw new Error();
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return await compress(data);
  } catch (e) {
    return null;
  }
}
function persist() {
  localStorage.setItem(KEY, JSON.stringify(state.books));
}
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0591-\u05c7]/g, "")
    .replace(/[^\u0590-\u05ffa-z0-9]/g, "");
}
function render() {
  const q = normalize(search.value);
  let list = state.books.filter(
    (b) => b.status === state.status && (!q || normalize(b.title).includes(q)),
  );
  list.sort(
    sort.value === "az"
      ? (a, b) => a.title.localeCompare(b.title, "he")
      : (a, b) => b.created - a.created,
  );
  count.textContent = list.length + " ספרים";
  subtitle.textContent = subtitles[state.status];
  books.className = list.length ? state.view : "";
  books.innerHTML = list.length
    ? list.map(card).join("")
    : '<div class="empty"><div style="font-size:45px">▥</div><h2>אין כאן ספרים</h2><p>לא נמצאו ספרים במסך הזה.</p></div>';
  books
    .querySelectorAll(".book")
    .forEach((el) => (el.onclick = () => openDetail(el.dataset.id)));
  books.querySelectorAll(".googleCover").forEach(
    (btn) =>
      (btn.onclick = (e) => {
        e.stopPropagation();
        openGoogleImages(btn.dataset.title, btn.dataset.id);
      }),
  );
}
function card(b) {
  const cls =
    b.status === "בדיונים"
      ? "discuss"
      : b.status === "השגתי"
        ? "got"
        : b.status === "סל מחזור"
          ? "trash"
          : "";
  const c = b.cover
    ? '<img src="' + esc(b.cover) + '">'
    : '<div class="fallback">' + esc(b.title) + "</div>";
  return (
    '<article class="book" data-id="' +
    b.id +
    '"><div class="cover">' +
    c +
    '</div><div class="body"><div class="title">' +
    esc(b.title) +
    '</div><div class="author">' +
    esc(b.author || "שם הסופר טרם הוזן") +
    '</div><button class="ghost googleCover" data-id="' +
    b.id +
    '" data-title="' +
    esc(b.title) +
    '" style="margin-top:9px;padding:7px 9px;font-size:12px">איתור כריכה</button></div><span class="badge ' +
    cls +
    '">' +
    b.status +
    "</span></article>"
  );
}
function changePage(n) {
  state.status = n.dataset.status;
  document
    .querySelectorAll(".nav")
    .forEach((x) => x.classList.toggle("active", x === n));
  search.value = "";
  render();
}
function openAdd() {
  state.selected = null;
  modalTitle.textContent = "הוספת ספר";
  ["id", "created", "bookTitle", "author", "coverData", "notes"].forEach(
    (x) => (document.getElementById(x).value = ""),
  );
  results.innerHTML = "";
  previewWrap.innerHTML = "";
  modal.classList.add("open");
}
function findBook() {
  const title = bookTitle.value.trim();
  if (!title) return toast("צריך להזין שם ספר");
  openGoogleImages(title, "form");
}
function loadImage() {
  const f = image.files[0];
  if (!f) return;
  if (f.size > 4 * 1024 * 1024) return toast("התמונה גדולה מדי");
  const r = new FileReader();
  r.onload = () =>
    compress(r.result).then((data) => {
      coverData.value = data;
      showPreview(data);
    });
  r.readAsDataURL(f);
}
function compress(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 700,
        scale = Math.min(1, max / Math.max(img.width, img.height)),
        c = document.createElement("canvas");
      c.width = img.width * scale;
      c.height = img.height * scale;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.75));
    };
    img.src = src;
  });
}
function showPreview(src) {
  previewWrap.innerHTML = src ? '<img class="preview" src="' + src + '">' : "";
}
async function saveBook() {
  const title = bookTitle.value.trim();
  if (!title) return toast("צריך להזין שם ספר");
  const duplicate = state.books.find(
    (b) =>
      normalize(b.title) === normalize(title) &&
      b.id !== id.value &&
      b.status !== "סל מחזור",
  );
  if (duplicate) return toast("הספר כבר קיים ברשימה");
  if (!state.user) return toast("צריך להתחבר קודם");
  save.disabled = true;
  save.textContent = "שומר...";
  const book = {
    id: id.value || crypto.randomUUID(),
    title,
    author: author.value.trim(),
    cover: coverData.value,
    notes: notes.value.trim(),
    status: state.selected ? state.selected.status : "מחפש",
    created: +created.value || Date.now(),
  };
  const { error } = await db.from("books").upsert(bookToRow(book));
  save.disabled = false;
  save.textContent = "שמירה";
  if (error)
    return toast(
      error.code === "23505" ? "הספר כבר קיים ברשימה" : "שמירת הספר נכשלה",
    );
  const at = state.books.findIndex((b) => b.id === book.id);
  if (at >= 0) state.books[at] = book;
  else state.books.unshift(book);
  persist();
  modal.classList.remove("open");
  toast("הספר נשמר בלי שינוי אוטומטי");
  render();
}
function openDetail(bookId) {
  const b = state.books.find((x) => x.id === bookId);
  state.selected = b;
  const c = b.cover
    ? '<div class="cover" style="border-radius:16px"><img src="' +
      esc(b.cover) +
      '"></div>'
    : "";
  let buttons = "";
  if (b.status === "מחפש")
    buttons =
      '<button class="ghost" data-move="בדיונים">העבר לבדיונים</button><button class="primary" data-move="השגתי">השגתי</button>';
  if (b.status === "בדיונים")
    buttons =
      '<button class="ghost" data-move="מחפש">החזר למחפש</button><button class="primary" data-move="השגתי">השגתי</button>';
  if (b.status === "השגתי")
    buttons = '<button class="ghost" data-move="מחפש">החזר למחפש</button>';
  if (b.status === "סל מחזור")
    buttons = '<button class="primary" data-move="מחפש">שחזור</button>';
  if (b.status !== "סל מחזור")
    buttons +=
      '<button class="danger" data-move="סל מחזור">לסל המחזור</button>';
  detail.innerHTML =
    c +
    "<h2>" +
    esc(b.title) +
    "</h2><p><strong>סופר:</strong> " +
    esc(b.author || "טרם הוזן") +
    "</p><p><strong>הערות:</strong> " +
    esc(b.notes || "אין הערות") +
    '</p><div class="actions"><button id="edit" class="ghost">עריכה</button><button id="googleDetail" class="ghost">איתור כריכה</button>' +
    buttons +
    "</div>";
  edit.onclick = editBook;
  googleDetail.onclick = () => openGoogleImages(b.title, b.id);
  detail
    .querySelectorAll("[data-move]")
    .forEach((x) => (x.onclick = () => moveBook(x.dataset.move)));
  detailModal.classList.add("open");
}
function editBook() {
  const b = state.selected;
  detailModal.classList.remove("open");
  modalTitle.textContent = "עריכת ספר";
  id.value = b.id;
  created.value = b.created;
  bookTitle.value = b.title;
  author.value = b.author;
  coverData.value = b.cover;
  notes.value = b.notes;
  results.innerHTML = "";
  showPreview(b.cover);
  modal.classList.add("open");
}
async function moveBook(status) {
  const msg =
    status === "השגתי"
      ? "האם להעביר את הספר לספרים שהשגתי?"
      : status === "סל מחזור"
        ? "האם להעביר את הספר לסל המחזור?"
        : "האם להעביר את הספר?";
  if (!confirm(msg)) return;
  const old = state.selected.status;
  state.selected.status = status;
  const { error } = await db
    .from("books")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", state.selected.id);
  if (error) {
    state.selected.status = old;
    return toast("העברת הספר נכשלה");
  }
  persist();
  detailModal.classList.remove("open");
  toast("הספר הועבר וסונכרן");
  render();
}
function toast(t) {
  const x = document.getElementById("toast");
  x.textContent = t;
  x.classList.add("show");
  clearTimeout(x.timer);
  x.timer = setTimeout(() => x.classList.remove("show"), 2800);
}
function esc(s) {
  return String(s || "").replace(
    /[&<>'"]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[c],
  );
}
init();
