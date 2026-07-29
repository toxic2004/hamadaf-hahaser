(function recoverInvalidLocalState() {
  const key = "hamadaf-hahaser-v1";
  const backupPrefix = "hamadaf-hahaser-invalid-backup-";

  try {
    const saved = localStorage.getItem(key);
    if (!saved) return;

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      throw new Error("Local books state is not an array");
    }
  } catch (error) {
    try {
      const brokenValue = localStorage.getItem(key);
      if (brokenValue !== null) {
        localStorage.setItem(backupPrefix + Date.now(), brokenValue);
        localStorage.removeItem(key);
      }
    } catch (storageError) {
      console.error("Local state recovery failed", storageError);
    }

    console.warn("Invalid local state was backed up and removed", error);
  }
})();
