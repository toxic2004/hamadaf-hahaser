(function loadAppWithCoverStorage() {
  if (document.querySelector("script[data-hamadaf-original-app]")) return;

  function showLoadError(message) {
    const syncText = document.getElementById("syncText");
    if (syncText) syncText.textContent = "שגיאה בטעינת האפליקציה";
    const toast = document.getElementById("toast");
    if (toast) {
      toast.textContent = message;
      toast.classList.add("show");
    }
  }

  function loadManualImport() {
    if (window.HamadafManualImport) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = "./manual-import.js?v=local-import-signature-20260729-1";
      script.async = false;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  const oldInit = `async function init() {
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
        priority: "רגילה",
        isFavorite: false,
        isRequired: false,
      }));
  bind();
  render();
  const { data } = await db.auth.getSession();
  if (data.session) await connected(data.session.user);
  db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session) connected(session.user);
    if (event === "SIGNED_OUT") disconnected();
  });
}`;

  const newInit = `async function init() {
  const saved = localStorage.getItem(KEY);
  const localBooks = window.HamadafManualImport.parseLocalBooks(saved);
  bind();
  const { data, error } = await db.auth.getSession();
  if (error) {
    state.books = localBooks || INITIAL.map((title, i) => ({
      id: crypto.randomUUID(),
      title,
      author: "",
      cover: "",
      notes: "",
      status: "מחפש",
      created: Date.now() - i,
      priority: "רגילה",
      isFavorite: false,
      isRequired: false,
    }));
    render();
    syncText.textContent = "שגיאת התחברות";
  } else if (data.session) {
    state.books = [];
    render();
    await connected(data.session.user, localBooks);
  } else {
    state.books = localBooks || INITIAL.map((title, i) => ({
      id: crypto.randomUUID(),
      title,
      author: "",
      cover: "",
      notes: "",
      status: "מחפש",
      created: Date.now() - i,
      priority: "רגילה",
      isFavorite: false,
      isRequired: false,
    }));
    render();
  }
  db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session) {
      const pendingLocalBooks = window.HamadafManualImport.parseLocalBooks(
        localStorage.getItem(KEY),
      );
      connected(session.user, pendingLocalBooks);
    }
    if (event === "SIGNED_OUT") disconnected();
  });
}`;

  const oldConnected = `async function connected(user) {
  state.user = user;
  authModal.classList.remove("open");
  signOut.style.display = "inline-block";
  syncText.textContent = "מסונכרן לחשבון " + user.email;
  await loadRemote();
}`;

  const newConnected = `async function connected(user, localBooks = null) {
  state.user = user;
  authModal.classList.remove("open");
  signOut.style.display = "inline-block";
  syncText.textContent = "מסונכרן לחשבון " + user.email;
  await loadRemote(localBooks);
}`;

  const oldLoadRemote = `async function loadRemote() {
  syncText.textContent = "מסנכרן...";
  const { data, error } = await db
    .from("books")
    .select("*")
    .eq("user_id", state.user.id)
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
  persist();
  render();
  syncText.textContent = "מסונכרן לחשבון " + state.user.email;
}`;

  const newLoadRemote = `async function loadRemote(localBooks = null) {
  syncText.textContent = "מסנכרן...";
  const { data, error } = await db
    .from("books")
    .select("*")
    .eq("user_id", state.user.id)
    .order("created_at", { ascending: false });
  if (error) {
    syncText.textContent = "שגיאת סנכרון";
    return toast("לא ניתן לטעון את הספרים");
  }

  const remoteBooks = (data || []).map(rowToBook);
  state.books = remoteBooks;
  render();
  syncText.textContent = "מסונכרן לחשבון " + state.user.email;

  if (!localBooks || !localBooks.length) {
    persist();
    return;
  }

  const result = await window.HamadafManualImport.promptAndImport({
    document,
    db,
    user: state.user,
    localBooks,
    remoteBooks,
    bookToRow,
    onImported(importedBooks) {
      state.books = importedBooks.concat(remoteBooks);
      persist();
      render();
      toast(importedBooks.length + " ספרים יובאו לענן");
    },
  });

  if (result.status === "completed" && result.imported === 0) persist();
}`;

  loadManualImport()
    .then(function () {
      return fetch("./app.js?v=manual-import-confirmation-20260729-1", {
        cache: "no-store",
      });
    })
    .then(function (response) {
      if (!response.ok) throw new Error("app.js fetch failed");
      return response.text();
    })
    .then(function (source) {
      const patchedSource = source
        .replace(
          "const db = HamadafSupabase.createClient();",
          "window.db = HamadafSupabase.createClient();",
        )
        .replace("const state = {", "window.state = {")
        .replace(oldInit, newInit)
        .replace(oldConnected, newConnected)
        .replace(oldLoadRemote, newLoadRemote);

      if (
        patchedSource === source ||
        !patchedSource.includes(newInit) ||
        !patchedSource.includes(newConnected) ||
        !patchedSource.includes(newLoadRemote)
      ) {
        throw new Error("Expected app sections were not found");
      }

      const appScript = document.createElement("script");
      appScript.textContent = patchedSource;
      appScript.dataset.hamadafOriginalApp = "true";
      document.head.appendChild(appScript);

      const storageScript = document.createElement("script");
      storageScript.src = "./cover-storage.js?v=race-lock-fix-20260904-1";
      storageScript.async = false;
      storageScript.dataset.hamadafCoverStorage = "true";
      storageScript.onerror = function () {
        showLoadError("רכיב שמירת הכריכות לא נטען. נסה לרענן את הדף");
      };
      document.head.appendChild(storageScript);
    })
    .catch(function (error) {
      console.error("Application loader failed", error);
      showLoadError("האפליקציה לא נטענה. סגור את הלשונית ופתח מחדש");
    });
})();
