(function scheduleLegacyCoverMigration() {
  const BUCKET = "book-covers";
  const MAX_WAIT_MS = 60000;
  const POLL_MS = 500;
  const startedAt = Date.now();

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

  function toast(message) {
    if (typeof window.toast === "function") window.toast(message);
  }

  async function runMigration() {
    if (window.__hamadafLegacyCoverMigrationRunning) return;
    window.__hamadafLegacyCoverMigrationRunning = true;

    try {
      const { data: rows, error: readError } = await window.db
        .from("books")
        .select("id,title,cover,cover_path")
        .is("cover_path", null);

      if (readError) throw readError;

      const candidates = (rows || []).filter((row) =>
        /^data:image\/[^;]+;base64,/i.test(String(row.cover || "")),
      );

      if (!candidates.length) {
        toast("כל הכריכות כבר הועברו ל-Storage");
        return;
      }

      let migrated = 0;
      let failed = 0;
      toast("מתחיל להעביר " + candidates.length + " כריכות ל-Storage");

      for (let index = 0; index < candidates.length; index += 1) {
        const row = candidates[index];
        let uploadedPath = "";

        try {
          const converted = dataUrlToBytes(row.cover);
          uploadedPath =
            window.state.user.id +
            "/" +
            row.id +
            "/legacy-migration-" +
            Date.now() +
            "-" +
            index +
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

          const localBook = Array.isArray(window.state.books)
            ? window.state.books.find((book) => book.id === row.id)
            : null;
          if (localBook) localBook.coverPath = uploadedPath;
          migrated += 1;
        } catch (error) {
          failed += 1;
          console.error(
            "Legacy cover migration failed",
            row.id,
            row.title,
            error,
          );
          if (uploadedPath) {
            try {
              await window.db.storage.from(BUCKET).remove([uploadedPath]);
            } catch (cleanupError) {
              console.error(
                "Failed to clean partial upload",
                uploadedPath,
                cleanupError,
              );
            }
          }
        }

        if ((index + 1) % 10 === 0 || index + 1 === candidates.length) {
          toast(
            "התקדמות מיגרציה: " +
              (index + 1) +
              "/" +
              candidates.length +
              ", הצליחו " +
              migrated +
              (failed ? ", נכשלו " + failed : ""),
          );
        }
      }

      toast(
        failed
          ? "הועברו " +
              migrated +
              " כריכות. " +
              failed +
              " נכשלו ונשארו ללא שינוי"
          : "כל " + migrated + " הכריכות הועברו ל-Storage",
      );
    } catch (error) {
      console.error("Full legacy cover migration failed", error);
      toast("מיגרציית הכריכות נכשלה. נתוני ה-Base64 נשארו ללא שינוי");
    } finally {
      window.__hamadafLegacyCoverMigrationRunning = false;
    }
  }

  function waitUntilReady() {
    const ready =
      window.db &&
      window.state &&
      window.state.user &&
      Array.isArray(window.state.books);

    if (ready) {
      runMigration();
      return;
    }

    if (Date.now() - startedAt >= MAX_WAIT_MS) {
      console.error(
        "Legacy cover migration did not start because the app was not ready",
      );
      toast("המיגרציה לא התחילה. סגור את האפליקציה ופתח מחדש");
      return;
    }

    setTimeout(waitUntilReady, POLL_MS);
  }

  waitUntilReady();
})();
