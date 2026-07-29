(function (root) {
  "use strict";

  const localKey = "hamadaf-hahaser-v1";
  const backupPrefix = "hamadaf-hahaser-invalid-backup-";

  try {
    const saved = root.localStorage?.getItem(localKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) throw new Error("Local books state is not an array");
    }
  } catch (error) {
    try {
      const brokenValue = root.localStorage?.getItem(localKey);
      if (brokenValue !== null && brokenValue !== undefined) {
        root.localStorage.setItem(backupPrefix + Date.now(), brokenValue);
        root.localStorage.removeItem(localKey);
      }
    } catch (storageError) {
      console.error("Local state recovery failed", storageError);
    }
    console.warn("Invalid local state was backed up and removed", error);
  }

  const url = "https://mfxhmnzyfhlaiqctchvb.supabase.co";
  const publishableKey = "sb_publishable_joNTfIdJZ1t34wsl1S_d3g_aWmhHdaB";
  root.HamadafSupabase = {
    createClient() {
      if (!root.supabase?.createClient)
        throw new Error("Supabase client is unavailable");
      return root.supabase.createClient(url, publishableKey);
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
