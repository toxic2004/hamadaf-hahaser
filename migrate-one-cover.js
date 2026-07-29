(async function migrateAllLegacyCovers() {
  const BUCKET = "book-covers";

  if (!window.db || !window.state || !window.state.user) return;

  function dataUrlToBytes(dataUrl) {
    const parts = String(dataUrl || "").split(",");
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

  const { data: rows, error: readError } = await window.db
    .from("books")
    .select("id,title,cover,cover_path")
    .is("cover_path", null);

  if (readError) {
    console.error("Legacy cover migration read failed", readError);
    return;
  }

  const candidates = (rows || []).filter((row) =>
    String(row.cover || "").startsWith("data:image/"),
  );

  if (!candidates.length) return;

  let migrated = 0;
  let failed = 0;

  if (typeof window.toast === "function") {
    window.toast("מעביר " + candidates.length + " כריכות ל-Storage...");
  }

  for (const row of candidates) {
    let uploadedPath = "";

    try {
      const converted = dataUrlToBytes(row.cover);
      uploadedPath =
        window.state.user.id +
        "/" +
        row.id +
        "/legacy-migration-" +
        Date.now() +
        "." +
        extensionFor(converted.mime);

      const { error: uploadError } = await window.db.storage
        .from(BUCKET)
        .upload(uploadedPath, converted.bytes, {
          contentType: converted.mime,
          cacheControl: "3600",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data: updatedRows, error: updateError } = await window.db
        .from("books")
        .update({
          cover_path: uploadedPath,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .is("cover_path", null)
        .select("id");
      if (updateError) throw updateError;
      if (!updatedRows || updatedRows.length !== 1) {
        throw new Error("Book was not updated");
      }

      const localBook = window.state.books.find((book) => book.id === row.id);
      if (localBook) localBook.coverPath = uploadedPath;
      migrated += 1;
    } catch (error) {
      failed += 1;
      console.error("Legacy cover migration failed", row.id, row.title, error);
      if (uploadedPath) {
        await window.db.storage.from(BUCKET).remove([uploadedPath]);
      }
    }
  }

  if (typeof window.toast === "function") {
    window.toast(
      failed
        ? "הועברו " + migrated + " כריכות. " + failed + " נכשלו ונשארו ללא שינוי"
        : "כל " + migrated + " הכריכות הועברו ל-Storage",
    );
  }
})();
