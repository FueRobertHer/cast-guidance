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
// It sets `data-theme` and, for a theme of one's own, its values on <html>
// through `style.setProperty`, which the CSP's `style-src` does not gate.
(function () {
  var KEY = 'cast-guidance:theme';
  var APPLIED = 'cast-guidance:theme-applied';
  // Each built-in theme's page colour (src/theme/builtins.ts).
  var color = {
    dark: '#121110',
    light: '#eee6d5',
    parchment: '#e9dfc6',
    modern: '#f2f4f7',
    contrast: '#000000',
  };
  var has = function (o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  };
  var root = document.documentElement;
  var theme = 'dark';
  var page = null;
  var scheme = null;
  var vars = null;

  // `?theme=reset` on any address: back to Dark, whatever a theme of one's
  // own did to the page, then off the address so a reload does not reset
  // again. The installed app reaches it from its icon's shortcut.
  try {
    var params = new URLSearchParams(location.search);
    if (params.get('theme') === 'reset') {
      params.delete('theme');
      var query = params.toString();
      history.replaceState(
        history.state,
        '',
        location.pathname + (query === '' ? '' : '?' + query) + location.hash,
      );
      localStorage.setItem(KEY, 'dark');
      localStorage.removeItem(APPLIED);
    }
  } catch (_) {
    // Storage blocked: Dark for this load is all a reset can do.
  }

  try {
    var choice = localStorage.getItem(KEY);
    if (choice !== 'system' && has(color, choice)) theme = choice;
    else if (choice === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches)
      theme = 'light';
    else if (typeof choice === 'string' && choice.indexOf('custom:') === 0) {
      // A theme of one's own, from the copy theme.ts keeps for this script,
      // and only if it is the one chosen. Checked again here, loosely, since
      // it is drawn before anything else runs.
      var applied = JSON.parse(localStorage.getItem(APPLIED) || 'null');
      if (
        applied !== null &&
        typeof applied === 'object' &&
        applied.v === 1 &&
        'custom:' + applied.id === choice &&
        has(color, applied.base) &&
        typeof applied.vars === 'object' &&
        applied.vars !== null
      ) {
        var names = Object.keys(applied.vars);
        var ok = names.length <= 100;
        for (var i = 0; ok && i < names.length; i++) {
          var value = applied.vars[names[i]];
          ok =
            /^--cg-[a-z0-9-]+$/.test(names[i]) &&
            typeof value === 'string' &&
            /^[#a-zA-Z0-9 .,%()"'*+-]{1,200}$/.test(value);
        }
        if (ok) {
          theme = applied.base;
          vars = applied.vars;
          scheme = applied.scheme === 'light' ? 'light' : 'dark';
          if (/^#[0-9a-f]{6}$/.test(applied.pageColour)) page = applied.pageColour;
        }
      }
    }
  } catch (_) {
    // Storage or matchMedia unavailable, or the copy unreadable: the default, dark.
  }
  // Anything else stored (a theme a newer or older build knew, a theme of
  // one's own with no copy to draw) is dark too, until the app draws it.
  root.setAttribute('data-theme', theme);
  if (vars !== null) {
    for (var name in vars) if (has(vars, name)) root.style.setProperty(name, vars[name]);
    root.style.setProperty('color-scheme', scheme);
  }
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', page || color[theme]);
})();
