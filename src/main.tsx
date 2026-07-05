import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from '@/app/router';
import '@/styles/app.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
