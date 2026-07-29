(function patchBookSearch() {
  const originalFetch = window.fetch.bind(window);
  const oldFilter = '(!q || normalize(b.title).includes(q))';
  const newFilter = `(
        !q ||
        [b.title, b.author, b.isbn, b.notes].some((value) =>
          normalize(value).includes(q),
        )
      )`;

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

    const patchedSource = source.replace(oldFilter, newFilter);
    window.fetch = originalFetch;
    return new Response(patchedSource, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
})();
