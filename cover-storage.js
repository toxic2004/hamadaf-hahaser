(function enableCoverStorage() {
  if (typeof db === "undefined" || typeof state === "undefined") return;
  if (!window.HamadafCoverStorageOps) return;

  const BUCKET = "book-covers";
  const PATH_PREFIX = "storage-path:";
  const UPLOAD_TIMEOUT_MS = 20000;
  // Selecting a new cover for a book (upload -> update DB -> delete the
  // book's previous cover file) is not safe to run twice concurrently
  // for the same book: two overlapping calls can each capture a stale
  // "previous cover" value and end up deleting the file the *other*
  // call just uploaded, leaving books.cover_path pointing at a file
  // that no longer exists (confirmed in production 2026-09-04 - a
  // book's cover_path referenced an object that had been deleted, with
  // zero files left in storage for that book at all). Track in-flight
  // saves per book and ignore extra clicks until the current one
  // finishes, instead of trying to make concurrent saves safe.
  const coverSaveInFlight = new Set();
  const originalRowToBook = rowToBook;
  const originalBookToRow = bookToRow;
  const originalLoadRemote = loadRemote;
  const originalSaveBook = saveBook;
  const originalEditBook = editBook;
  const originalOpenDetail = openDetail;
  // ROOT CAUSE (confirmed 2026-09-04 via a real user-visible error
  // message): persist() writes the *entire* state.books array,
  // including full base64 cover images, to localStorage on every save.
  // With Storage-backed covers this is unnecessary (the real cover
  // lives in Supabase Storage; state.books only needs the small
  // coverPath string), and legacy base64 covers plus this duplication
  // pushed total size over the browser's localStorage quota. When that
  // write throws (QuotaExceededError), it was happening *inside* the
  // try block of selectCoverWithStorage/saveBookWithStorage, so a
  // successful upload+DB-update was reported to the person as a total
  // failure. Fix: strip heavy image fields before writing to
  // localStorage, and never let a failure here (which is just an
  // offline-cache write, not the source of truth) propagate as an
  // error to the caller.
  const LOCAL_STORAGE_KEY = "hamadaf-hahaser-v1";
  persist = function persistWithoutHeavyCovers() {
    try {
      const lightweight = state.books.map((book) => {
        const copy = Object.assign({}, book);
        copy.cover = "";
        copy.legacyCover = "";
        return copy;
      });
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(lightweight));
    } catch (error) {
      console.error(
        "Persisting offline cache failed (data is still safe in Supabase)",
        error,
      );
    }
  };

  function pathMarker(path) {
    return PATH_PREFIX + path;
  }

  function markerPath(value) {
    return String(value || "").startsWith(PATH_PREFIX)
      ? String(value).slice(PATH_PREFIX.length)
      : "";
  }

  function dataUrlToBytes(dataUrl) {
    const parts = String(dataUrl).split(",");
    if (parts.length !== 2) throw new Error("Invalid image data");
    const mimeMatch = parts[0].match(/data:([^;]+);base64/i);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const decoded = atob(parts[1]);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i += 1) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return { bytes, mime };
  }

  function extensionFor(mime) {
    if (mime === "image/png") return "png";
    if (mime === "image/webp") return "webp";
    return "jpg";
  }

  function withTimeout(promise, milliseconds, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async function requireActiveUser() {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    const user = data && data.session && data.session.user;
    if (!user || !state.user || user.id !== state.user.id) {
      throw new Error("Not signed in");
    }
    return user;
  }

  async function uploadDataUrl(dataUrl, bookId) {
    const user = await requireActiveUser();
    const converted = dataUrlToBytes(dataUrl);
    const path =
      user.id +
      "/" +
      bookId +
      "/" +
      Date.now() +
      "." +
      extensionFor(converted.mime);

    const upload = db.storage.from(BUCKET).upload(path, converted.bytes, {
      contentType: converted.mime,
      cacheControl: "3600",
      upsert: false,
    });
    const { error } = await withTimeout(
      upload,
      UPLOAD_TIMEOUT_MS,
      "Cover upload timed out",
    );
    if (error) throw error;
    return path;
  }

  async function signedCoverUrl(path) {
    if (!path) return "";
    const { data, error } = await db.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60 * 24);
    if (error) throw error;
    return data.signedUrl;
  }

  async function refreshStoredCovers() {
    const booksWithPath = state.books.filter((book) => book.coverPath);
    await Promise.all(
      booksWithPath.map(async (book) => {
        try {
          book.cover = await signedCoverUrl(book.coverPath);
        } catch (error) {
          console.error("Cover URL creation failed", error);
        }
      }),
    );
    persist();
    render();
  }

  rowToBook = function rowToBookWithStorage(row) {
    const book = originalRowToBook(row);
    book.coverPath = row.cover_path || "";
    book.legacyCover = String(row.cover || "").startsWith("data:image/")
      ? row.cover
      : "";
    return book;
  };

  bookToRow = function bookToRowWithStorage(book) {
    const row = originalBookToRow(book);
    const path = book.coverPath || markerPath(book.cover);
    if (path) {
      row.cover_path = path;
      row.cover = book.legacyCover || "";
    } else {
      row.cover_path = null;
    }
    return row;
  };

  loadRemote = async function loadRemoteWithStorage(localBooks = null) {
    await originalLoadRemote(localBooks);
    await refreshStoredCovers();
  };

  editBook = function editBookWithStorage() {
    const book = state.selected;
    originalEditBook();
    if (book && book.coverPath) coverData.value = pathMarker(book.coverPath);
  };

  saveBook = async function saveBookWithStorage() {
    const currentValue = coverData.value;
    const selectedBook = state.selected;
    const previousPath = selectedBook && selectedBook.coverPath;
    let uploadedPath = "";
    let generatedId = "";

    try {
      if (String(currentValue).startsWith("data:image/")) {
        generatedId = id.value || crypto.randomUUID();
        if (!id.value) id.value = generatedId;
        save.disabled = true;
        save.textContent = "מעלה כריכה...";
        uploadedPath = await uploadDataUrl(currentValue, generatedId);
        coverData.value = pathMarker(uploadedPath);
      }

      await originalSaveBook();

      const savedId = id.value || generatedId;
      const book = state.books.find((item) => item.id === savedId);
      const path = uploadedPath || markerPath(book && book.cover);
      if (book && path) {
        book.coverPath = path;
        book.legacyCover = "";
        book.cover = await signedCoverUrl(path);
        persist();
        render();
      }

      if (uploadedPath && previousPath && previousPath !== uploadedPath) {
        const cleanup = await window.HamadafCoverStorageOps.removePath(
          db,
          BUCKET,
          previousPath,
        );
        if (!cleanup.ok) {
          console.error("Old cover cleanup failed", cleanup.error);
          toast("הכריכה החדשה נשמרה, אך ניקוי הכריכה הישנה נכשל");
        }
      }
    } catch (error) {
      console.error("Cover storage save failed", error);
      coverData.value = currentValue;
      if (uploadedPath) {
        await db.storage.from(BUCKET).remove([uploadedPath]);
      }
      save.disabled = false;
      save.textContent = "שמירה";
      toast(
        error && error.message === "Cover upload timed out"
          ? "העלאת הכריכה ארכה יותר מדי. נסה שוב"
          : "שמירת הכריכה נכשלה. הספר לא שונה",
      );
    }
  };

  selectCover = async function selectCoverWithStorage(src) {
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

    const book = state.books.find((item) => item.id === state.coverTarget);
    if (!book || !state.user) return;

    if (coverSaveInFlight.has(book.id)) {
      return toast("כבר מעדכן כריכה לספר הזה, נא להמתין לסיום");
    }
    coverSaveInFlight.add(book.id);

    let path = "";
    const previousPath = book.coverPath || "";
    try {
      path = await uploadDataUrl(stored, book.id);
      const { error } = await db
        .from("books")
        .update({
          cover_path: path,
          cover: "",
          updated_at: new Date().toISOString(),
        })
        .eq("id", book.id)
        .eq("user_id", state.user.id);
      if (error) throw error;

      book.coverPath = path;
      book.legacyCover = "";
      book.cover = await signedCoverUrl(path);
      persist();
      render();
      coverSearchModal.classList.remove("open");
      unlockScroll();

      if (previousPath && previousPath !== path) {
        const cleanup = await window.HamadafCoverStorageOps.removePath(
          db,
          BUCKET,
          previousPath,
        );
        if (!cleanup.ok) {
          console.error("Old cover cleanup failed", cleanup.error);
          return toast("הכריכה נשמרה, אך ניקוי הכריכה הישנה נכשל");
        }
      }

      toast("הכריכה נשמרה ב Storage וסונכרנה");
    } catch (error) {
      console.error("Cover selection upload failed", error);
      if (path) await db.storage.from(BUCKET).remove([path]);
      toast(
        error && error.message === "Cover upload timed out"
          ? "העלאת הכריכה ארכה יותר מדי. נסה שוב"
          : "שמירת הכריכה נכשלה. הכריכה הקודמת נשארה ללא שינוי",
      );
    } finally {
      coverSaveInFlight.delete(book.id);
    }
  };

  async function permanentlyDeleteSelectedBook() {
    const book = state.selected;
    if (!book || book.status !== "סל מחזור" || !state.user) return;
    if (!confirm("למחוק את הספר לצמיתות יחד עם הכריכה שלו?")) return;

    const result = await window.HamadafCoverStorageOps.deleteBookWithCover({
      db,
      bucket: BUCKET,
      book,
      userId: state.user.id,
      bookToRow,
    });

    if (result.status === "completed") {
      state.books = state.books.filter((item) => item.id !== book.id);
      state.selected = null;
      persist();
      render();
      detailModal.classList.remove("open");
      return toast("הספר והכריכה נמחקו לצמיתות");
    }

    if (result.status === "cleanup-failed-restored") {
      return toast("מחיקת הכריכה נכשלה. הספר שוחזר ולא נמחק");
    }

    if (result.status === "rollback-failed") {
      console.error("Book restore failed after cover cleanup error", result);
      return toast("אירעה שגיאה חמורה במחיקה. יש לבדוק את הנתונים");
    }

    toast("מחיקת הספר נכשלה");
  }

  openDetail = function openDetailWithPermanentDelete(bookId) {
    originalOpenDetail(bookId);
    const book = state.books.find((item) => item.id === bookId);
    if (!book || book.status !== "סל מחזור") return;
    const actions = detail.querySelector(".actions");
    if (!actions || document.getElementById("permanentDeleteBook")) return;
    const button = document.createElement("button");
    button.id = "permanentDeleteBook";
    button.className = "danger";
    button.textContent = "מחיקה לצמיתות";
    button.onclick = permanentlyDeleteSelectedBook;
    actions.appendChild(button);
  };

  save.onclick = saveBook;

  // ROOT CAUSE (confirmed 2026-09-04): checking the synchronous
  // `state.user` here is a race against app.js's own async auth
  // restoration. If app.js's connected()/loadRemote() already fired
  // (using the ORIGINAL, not-yet-wrapped loadRemote) before this script
  // finished evaluating and wrapping loadRemote, the initial book list
  // loads with correct cover_path values but never gets signed URLs
  // generated for them - covers were correctly saved server-side the
  // whole time (verified: file exists in Storage, cover_path correct),
  // but never displayed until the person re-triggers a cover save.
  // Querying the session directly (async, reliable regardless of
  // app.js's internal timing) instead of trusting this script's
  // snapshot of `state.user` fixes the race.
  db.auth.getSession().then(({ data }) => {
    if (data && data.session) refreshStoredCovers();
  });
})();
