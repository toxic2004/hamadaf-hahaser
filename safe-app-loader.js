(function loadOriginalAppForCompatibility() {
  if (document.querySelector('script[data-hamadaf-original-app]')) return;

  const script = document.createElement('script');
  script.src = './app.js?v=restore-20260729-1';
  script.async = false;
  script.dataset.hamadafOriginalApp = 'true';
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
