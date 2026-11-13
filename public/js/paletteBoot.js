/*
 * Applies the saved colour palette before the first paint.
 * This is a classic (non-module) script on purpose: it must run while the
 * document is parsed, and the CSP only allows same-origin external scripts.
 */
(function () {
  try {
    const saved = window.localStorage.getItem('scl.palette');
    if (saved === 'ember' || saved === 'violet' || saved === 'ocean') {
      document.documentElement.setAttribute('data-palette', saved);
    }
  } catch {
    /* storage can be blocked in private mode; the default palette still works */
  }
})();
