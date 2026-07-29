(function loadAppWithCoverStorage() {
  if (document.querySelector('script[data-hamadaf-original-app]')) return;

  function showLoadError(message) {
    const syncText = document.getElementById('syncText');
    if (syncText) syncText.textContent = 'שגיאה בטעינת האפליקציה';
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('show');
    }
  }

  fetch('./app.js?v=storage-runtime-fix-20260729-1', { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('app.js fetch failed');
      return response.text();
    })
    .then(function (source) {
      const patchedSource = source
        .replace(
          'const db = HamadafSupabase.createClient();',
          'window.db = HamadafSupabase.createClient();',
        )
        .replace('const state = {', 'window.state = {');

      if (patchedSource === source) {
        throw new Error('Expected app globals were not found');
      }

      const appScript = document.createElement('script');
      appScript.textContent = patchedSource;
      appScript.dataset.hamadafOriginalApp = 'true';
      document.head.appendChild(appScript);

      const storageScript = document.createElement('script');
      storageScript.src = './cover-storage.js?v=stage-2-runtime-fix-20260729-1';
      storageScript.async = false;
      storageScript.dataset.hamadafCoverStorage = 'true';
      storageScript.onerror = function () {
        showLoadError('רכיב שמירת הכריכות לא נטען. נסה לרענן את הדף');
      };
      document.head.appendChild(storageScript);
    })
    .catch(function (error) {
      console.error('Application loader failed', error);
      showLoadError('האפליקציה לא נטענה. סגור את הלשונית ופתח מחדש');
    });
})();