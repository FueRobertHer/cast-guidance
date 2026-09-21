import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from '@/app/router';
import { initDataLayer } from '@/data5e/loader';
import '@/styles/app.css';

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
