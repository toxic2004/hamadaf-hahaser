(function patchBookSearchAndDuplicates() {
  const originalFetch = window.fetch.bind(window);
  const oldFilter = '(!q || normalize(b.title).includes(q))';
  const newFilter = `(
        !q ||
        [b.title, b.author, b.isbn, b.notes].some((value) =>
          normalize(value).includes(q),
        )
      )`;

  const oldDuplicateCheck = `  const current = state.books.find((book) => book.id === id.value);
  const titleChanged =
    !current || normalize(current.title) !== normalize(title);
  const duplicate = state.books.find(
    (b) => normalize(b.title) === normalize(title) && b.id !== id.value,
  );
  if (titleChanged && duplicate) return toast("הספר כבר קיים ברשימה");
  if (!state.user) return toast("צריך להתחבר קודם");`;

  const newDuplicateCheck = `  const current = state.books.find((book) => book.id === id.value);
  const incomingAuthor = author.value.trim();
  const incomingIsbn = String(state.selected?.isbn || "").trim();
  const identityChanged =
    !current ||
    normalize(current.title) !== normalize(title) ||
    normalize(current.author) !== normalize(incomingAuthor) ||
    normalize(current.isbn) !== normalize(incomingIsbn);
  const candidates = state.books.filter((book) => book.id !== id.value);
  const isbnDuplicate = incomingIsbn
    ? candidates.find(
        (book) =>
          book.isbn && normalize(book.isbn) === normalize(incomingIsbn),
      )
    : null;
  const titleMatches = candidates.filter(
    (book) => normalize(book.title) === normalize(title),
  );
  const titleAuthorDuplicate = titleMatches.find(
    (book) => normalize(book.author) === normalize(incomingAuthor),
  );
  const exactDuplicate = isbnDuplicate || titleAuthorDuplicate;

  if (identityChanged && exactDuplicate) {
    if (exactDuplicate.status === "סל מחזור") {
      const shouldRestore = window.confirm(
        "הספר כבר נמצא בסל המחזור. לשחזר אותו במקום ליצור עותק חדש?",
      );
      if (!shouldRestore) return;
      if (!state.user) return toast("צריך להתחבר קודם");
      save.disabled = true;
      save.textContent = "משחזר...";
      const { error: restoreError } = await db
        .from("books")
        .update({ status: "מחפש", updated_at: new Date().toISOString() })
        .eq("id", exactDuplicate.id)
        .eq("user_id", state.user.id);
      save.disabled = false;
      save.textContent = "שמירה";
      if (restoreError) return toast("שחזור הספר נכשל");
      exactDuplicate.status = "מחפש";
      persist();
      modal.classList.remove("open");
      render();
      return toast("הספר שוחזר מסל המחזור");
    }
    return toast(
      isbnDuplicate
        ? "ספר עם ISBN זה כבר קיים ברשימה"
        : "הספר כבר קיים ברשימה עם אותו מחבר",
    );
  }

  const sameTitleDifferentAuthor = titleMatches.find(
    (book) => normalize(book.author) !== normalize(incomingAuthor),
  );
  if (identityChanged && sameTitleDifferentAuthor) {
    const shouldContinue = window.confirm(
      "כבר קיים ספר עם אותו שם אך מחבר שונה. ייתכן שזו מהדורה אחרת. להמשיך בשמירה?",
    );
    if (!shouldContinue) return;
  }

  if (!state.user) return toast("צריך להתחבר קודם");`;

  const searchInput = document.getElementById("search");
  if (searchInput) {
    searchInput.placeholder = "חיפוש לפי ספר, מחבר או ISBN";
  }

  window.fetch = async function patchedFetch(input, init) {
    const response = await originalFetch(input, init);
    const url = typeof input === "string" ? input : input?.url || "";
    if (!url.includes("app.js")) return response;

    const source = await response.text();
    if (!source.includes(oldFilter)) {
      throw new Error("Book search filter was not found");
    }
    if (!source.includes(oldDuplicateCheck)) {
      throw new Error("Book duplicate check was not found");
    }

    const patchedSource = source
      .replace(oldFilter, newFilter)
      .replace(oldDuplicateCheck, newDuplicateCheck)
      .replace(
        'בדיונים: "ספרים שנמצאים בדיונים או במשא ומתן"',
        'בדיונים: "ספרים שנמצאים בדיונים"',
      )
      .replaceAll("העבר למשא ומתן", "העבר לבדיונים");
    window.fetch = originalFetch;
    return new Response(patchedSource, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
})();