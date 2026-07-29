(function loadOriginalAppForCompatibility() {
  if (document.querySelector('script[data-hamadaf-original-app]')) return;

  const script = document.createElement('script');
  script.src = './app.js?v=restore-20260729-1';
  script.async = false;
  script.dataset.hamadafOriginalApp = 'true';
  script.onload = function () {
    const storageScript = document.createElement('script');
    storageScript.src = './cover-storage.js?v=stage-2-20260729-1';
    storageScript.async = false;
    storageScript.dataset.hamadafCoverStorage = 'true';
    storageScript.onerror = function () {
      const toast = document.getElementById('toast');
      if (toast) {
        toast.textContent = 'רכיב שמירת הכריכות לא נטען. נסה לרענן את הדף';
        toast.classList.add('show');
      }
    };
    document.head.appendChild(storageScript);
  };
  script.onerror = function () {
    const syncText = document.getElementById('syncText');
    if (syncText) syncText.textContent = 'שגיאה בטעינת האפליקציה';
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = 'האפליקציה לא נטענה. סגור את הלשונית ופתח מחדש';
      toast.classList.add('show');
    }
  };
  document.head.appendChild(script);
})();
