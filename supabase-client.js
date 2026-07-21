(function (root) {
  "use strict";
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
