// Draws the page in the player's theme before first paint (DS-001).
//
// A classic script in <head>, ahead of the stylesheet and the app's bundle, so
// it blocks rendering until `data-theme` is set and nothing flashes in the
// wrong theme. It is a file rather than inline because the enforced CSP is
// `script-src 'self'` with no hashes (docs/security-headers.md). The service
// worker precaches it with the rest of the shell.
//
// src/lib/theme.ts owns the theme from then on and documents the choices;
// src/lib/theme.test.ts runs this file against it, so the two cannot disagree.
(function () {
  var color = { dark: '#121110', light: '#eee6d5' };
  var theme = 'dark';
  try {
    var choice = localStorage.getItem('cast-guidance:theme');
    if (choice === 'light') theme = 'light';
    else if (choice === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches)
      theme = 'light';
  } catch (_) {
    // Storage or matchMedia unavailable: the default, dark.
  }
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color[theme]);
})();
