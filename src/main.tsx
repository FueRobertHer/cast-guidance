// First, ahead of any module that brings a stylesheet of its own (the roll
// toast's chip faces, through the router): the minifier keeps a `/*!` banner
// only at the top of the stylesheet, and the notices find Tailwind by its banner.
import '@/styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from '@/app/router';
import { initDataLayer } from '@/data5e/loader';
// The two type families, self-hosted as Latin-subset woff2 so they work
// offline (the workbox glob precaches them) and need no font origin in the
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
