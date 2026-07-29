(async function loadSafeApp() {
  const response = await fetch("./app.js", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("לא ניתן לטעון את קוד האפליקציה");
  }

  let source = await response.text();
  const initCall = /\ninit\(\);\s*$/;
  if (!initCall.test(source)) {
    throw new Error("מבנה קובץ האפליקציה אינו תואם לטעינה הבטוחה");
  }

  source = source.replace(initCall, `

function localImportIdentity(book) {
  const isbn = String(book.isbn || "").replace(/[^0-9X]/gi, "").toUpperCase();
  if (isbn) return "isbn:" + isbn;

  const title = normalize(book.title);
  const author = normalize(book.author);
  return author ? "title-author:" + title + ":" + author : "title:" + title;
}

function prepareLocalImport(localBooks, remoteBooks) {
  const remoteKeys = new Set(remoteBooks.map(localImportIdentity));
  const seenLocal = new Set();
  const candidates = [];
  let duplicateCount = 0;

  for (const book of localBooks) {
    const key = localImportIdentity(book);
    if (!key || remoteKeys.has(key) || seenLocal.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seenLocal.add(key);
    candidates.push(book);
  }

  return { candidates, duplicateCount };
}

function requestLocalImportApproval(foundCount, addCount, duplicateCount) {
  return new Promise((resolve) => {
    let overlay = document.getElementById("localImportModal");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "localImportModal";
      overlay.className = "overlay";
      overlay.innerHTML = \\`
        <div class="modal" style="max-width:520px;align-self:center">
          <div class="head"><h2>ייבוא רשימה מקומית</h2></div>
          <p>נמצאה במכשיר רשימה מקומית. שום ספר לא יועלה לענן בלי אישורך.</p>
          <div class="field" style="line-height:1.9">
            <div>ספרים שנמצאו במכשיר: <strong id="localFoundCount"></strong></div>
            <div>ספרים חדשים שיועלו: <strong id="localAddCount"></strong></div>
            <div>כפילויות שלא יועלו: <strong id="localDuplicateCount"></strong></div>
          </div>
          <p class="sub">ביטול ישאיר את הרשימה המקומית ללא שינוי ולא יעלה דבר לענן.</p>
          <div class="actions">
            <button id="confirmLocalImport" class="primary">אישור ייבוא</button>
            <button id="cancelLocalImport" class="ghost">ביטול</button>
          </div>
        </div>
      \\`;
      document.body.appendChild(overlay);
    }

    overlay.querySelector("#localFoundCount").textContent = foundCount;
    overlay.querySelector("#localAddCount").textContent = addCount;
    overlay.querySelector("#localDuplicateCount").textContent = duplicateCount;
    overlay.classList.add("open");

    const finish = (approved) => {
      overlay.classList.remove("open");
      resolve(approved);
    };

    overlay.querySelector("#confirmLocalImport").onclick = () => finish(true);
    overlay.querySelector("#cancelLocalImport").onclick = () => finish(false);
  });
}

loadRemote = async function loadRemoteSafely() {
  syncText.textContent = "מסנכרן...";
  const { data, error } = await db
    .from("books")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    syncText.textContent = "שגיאת סנכרון";
    return toast("לא ניתן לטעון את הספרים");
  }

  const remoteBooks = data.map(rowToBook);

  if (!data.length && state.books.length) {
    const localBooks = state.books.slice();
    const { candidates, duplicateCount } = prepareLocalImport(localBooks, remoteBooks);
    const approved = await requestLocalImportApproval(
      localBooks.length,
      candidates.length,
      duplicateCount,
    );

    if (!approved) {
      render();
      syncText.textContent = "הרשימה המקומית לא יובאה";
      return toast("לא בוצע ייבוא. הרשימה המקומית נשארה ללא שינוי");
    }

    if (candidates.length) {
      let { error: migrateError } = await db
        .from("books")
        .upsert(candidates.map(bookToRow));

      if (isMissingUpgrade(migrateError)) {
        const fallback = await db
          .from("books")
          .upsert(candidates.map(legacyBookRow));
        migrateError = fallback.error;
        if (!migrateError) {
          toast("הספרים יובאו. יש להפעיל את מיגרציות השדרוג.");
        }
      }

      if (migrateError) {
        syncText.textContent = "שגיאת סנכרון";
        return toast("ייבוא הרשימה לענן נכשל. לא נמחקו ספרים קיימים");
      }
    }

    persist();
    render();
    syncText.textContent = "מסונכרן לחשבון " + state.user.email;
    return toast(
      candidates.length
        ? candidates.length + " ספרים יובאו. כפילויות לא הועלו"
        : "לא נמצאו ספרים חדשים לייבוא",
    );
  }

  state.books = remoteBooks;
  persist();
  render();
  syncText.textContent = "מסונכרן לחשבון " + state.user.email;
};

init();
`);

  new Function(source)();
})().catch((error) => {
  console.error("Safe app loader failed", error);
  const syncText = document.getElementById("syncText");
  if (syncText) syncText.textContent = "שגיאה בטעינת האפליקציה";
  const toast = document.getElementById("toast");
  if (toast) {
    toast.textContent = "האפליקציה לא נטענה. רענן את הדף";
    toast.classList.add("show");
  }
});
