(async function migrateOneLegacyCover() {
  const TARGET_BOOK_ID = "00b5b580-befa-40bc-b520-4f778ecff8e3";
  const TARGET_BOOK_TITLE = "המטופלת השקטה";
  const BUCKET = "book-covers";

  if (!window.db || !window.state || !window.state.user) return;

  function dataUrlToBytes(dataUrl) {
    const parts = String(dataUrl || "").split(",");
    if (parts.length !== 2) throw new Error("Invalid image data");
    const mimeMatch = parts[0].match(/data:([^;]+);base64/i);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const decoded = atob(parts[1]);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i);
    return { bytes, mime };
  }

  function extensionFor(mime) {
    if (mime === "image/png") return "png";
    if (mime === "image/webp") return "webp";
    return "jpg";
  }

  let uploadedPath = "";

  try {
    const { data: row, error: readError } = await window.db
      .from("books")
      .select("id,title,cover,cover_path")
      .eq("id", TARGET_BOOK_ID)
      .maybeSingle();

    if (readError) throw readError;
    if (!row || row.cover_path || !String(row.cover || "").startsWith("data:image/")) return;

    const converted = dataUrlToBytes(row.cover);
    uploadedPath =
      window.state.user.id +
      "/" +
      TARGET_BOOK_ID +
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

    const { error: updateError } = await window.db
      .from("books")
      .update({ cover_path: uploadedPath, updated_at: new Date().toISOString() })
      .eq("id", TARGET_BOOK_ID)
      .is("cover_path", null);
    if (updateError) throw updateError;

    const localBook = window.state.books.find((book) => book.id === TARGET_BOOK_ID);
    if (localBook) localBook.coverPath = uploadedPath;

    if (typeof window.toast === "function") {
      window.toast("הכריכה של ״" + TARGET_BOOK_TITLE + "״ הועברה ל-Storage");
    }
  } catch (error) {
    console.error("Single legacy cover migration failed", error);
    if (uploadedPath) {
      await window.db.storage.from(BUCKET).remove([uploadedPath]);
    }
    if (typeof window.toast === "function") {
      window.toast("העברת כריכת המבחן נכשלה. הנתון הישן נשאר ללא שינוי");
    }
  }
})();
