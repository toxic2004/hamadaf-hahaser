(function exposeCoverStorageOperations(global) {
  async function removePath(db, bucket, path) {
    if (!path) return { ok: true, skipped: true };
    const { error } = await db.storage.from(bucket).remove([path]);
    return error ? { ok: false, error } : { ok: true };
  }

  async function deleteBookWithCover(options) {
    const { db, bucket, book, userId, bookToRow } = options;
    const query = db
      .from("books")
      .delete()
      .eq("id", book.id)
      .eq("user_id", userId);
    const { error: deleteError } = await query;
    if (deleteError) {
      return { status: "delete-failed", error: deleteError };
    }

    const coverPath = book.coverPath || "";
    const cleanup = await removePath(db, bucket, coverPath);
    if (cleanup.ok) {
      return { status: "completed", deletedCover: Boolean(coverPath) };
    }

    const { error: restoreError } = await db
      .from("books")
      .upsert(bookToRow(book));
    if (restoreError) {
      return {
        status: "rollback-failed",
        cleanupError: cleanup.error,
        restoreError,
      };
    }

    return { status: "cleanup-failed-restored", cleanupError: cleanup.error };
  }

  global.HamadafCoverStorageOps = {
    deleteBookWithCover,
    removePath,
  };
})(typeof window === "undefined" ? globalThis : window);
