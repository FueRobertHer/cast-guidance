// First, ahead of any module that brings a stylesheet of its own (the roll
// toast's chip faces, through the router): the minifier keeps a `/*!` banner
// only at the top of the stylesheet, and the notices find Tailwind by its banner.
import '@/styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from '@/app/router';
import { initDataLayer } from '@/data5e/loader';
// The default themes' two type families, self-hosted as Latin-subset woff2
// so they work offline (the workbox glob precaches them) and need no font origin in the
// CSP. Imported here rather than from app.css so each package is a module in
// the bundle and the third-party notices (LEGAL-001) carry its licence. Only
// the weights the type scale uses: Literata 600 for titles, Atkinson
// Hyperlegible Next 400, 600 and 700 for everything else. After app.css: the
// minifier keeps a `/*!` banner only at the top of the stylesheet, and the
// notices find Tailwind by its banner.
import '@fontsource/literata/latin-600.css';
import '@fontsource/atkinson-hyperlegible-next/latin-400.css';
import '@fontsource/atkinson-hyperlegible-next/latin-600.css';
import '@fontsource/atkinson-hyperlegible-next/latin-700.css';
// Faces only the other built-in themes draw in (src/theme/builtins.ts):
// Parchment's Literata 400 and 700 and Alegreya, Modern's Inter. A
// browser fetches a face only when a rule asks for it, so these cost nothing
// until a theme does. They stay out of the precache (vite.config.ts); the
// service worker keeps each on its first fetch, and picking a theme fetches
// all of its faces (theme.ts).
import '@fontsource/literata/latin-400.css';
import '@fontsource/literata/latin-700.css';
import '@fontsource/alegreya/latin-600.css';
import '@fontsource/alegreya/latin-700.css';
import '@fontsource-variable/inter/wght.css';

// Before the tree mounts, not from an effect inside it: the first thing this
// does is resolve the data tag and ask whether a newer release exists, and
// neither needs React. Starting here overlaps both with mounting and routing
// instead of queueing behind them. It is idempotent, and the shell asks again
// on mount for anything that renders without this entry point (tests).
void initDataLayer();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
