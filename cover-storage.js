(function enableCoverStorage() {
  if (typeof db === "undefined" || typeof state === "undefined") return;

  const BUCKET = "book-covers";
  const PATH_PREFIX = "storage-path:";
  const UPLOAD_TIMEOUT_MS = 20000;
  const originalRowToBook = rowToBook;
  const originalBookToRow = bookToRow;
  const originalLoadRemote = loadRemote;
  const originalSaveBook = saveBook;
  const originalEditBook = editBook;

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

  loadRemote = async function loadRemoteWithStorage() {
    await originalLoadRemote();
    await refreshStoredCovers();
  };

  editBook = function editBookWithStorage() {
    const book = state.selected;
    originalEditBook();
    if (book && book.coverPath) coverData.value = pathMarker(book.coverPath);
  };

  saveBook = async function saveBookWithStorage() {
    const currentValue = coverData.value;
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
        book.cover = await signedCoverUrl(path);
        persist();
        render();
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

    let path = "";
    try {
      path = await uploadDataUrl(stored, book.id);
      const { error } = await db
        .from("books")
        .update({ cover_path: path, updated_at: new Date().toISOString() })
        .eq("id", book.id);
      if (error) throw error;

      book.coverPath = path;
      book.cover = await signedCoverUrl(path);
      persist();
      render();
      coverSearchModal.classList.remove("open");
      unlockScroll();
      toast("הכריכה נשמרה ב Storage וסונכרנה");
    } catch (error) {
      console.error("Cover selection upload failed", error);
      if (path) await db.storage.from(BUCKET).remove([path]);
      toast(
        error && error.message === "Cover upload timed out"
          ? "העלאת הכריכה ארכה יותר מדי. נסה שוב"
          : "שמירת הכריכה נכשלה. הכריכה הקודמת נשארה ללא שינוי",
      );
    }
  };

  save.onclick = saveBook;

  if (state.user) refreshStoredCovers();
})();