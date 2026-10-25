// @vitest-environment jsdom
// A11Y-002: the current section was told apart by colour alone. It now also
// carries a bar and a heavier weight, on exactly one tab.
import { cleanup, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppNavLayout } from './AppNav';

afterEach(cleanup);

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppNavLayout />,
        children: [
          { index: true, element: null },
          { path: 'library', element: null },
          { path: 'homebrew', element: null },
          { path: 'settings', element: null },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return within(screen.getByRole('navigation', { name: 'Main' }));
}

describe('AppNav current section', () => {
  it('marks only the open section with the bar', () => {
    const nav = renderAt('/library');
    const marked = nav
      .getAllByRole('link')
      .filter((l) => l.querySelector('[data-indicator]') !== null);
    expect(marked.map((l) => l.textContent)).toEqual(['Library']);
    expect(marked[0]?.getAttribute('aria-current')).toBe('page');
    expect(marked[0]?.className).toContain('font-semibold');
  });
});
