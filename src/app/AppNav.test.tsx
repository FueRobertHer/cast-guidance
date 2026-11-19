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
          { path: 'workshop/*', element: null },
          { path: 'homebrew', element: null },
          { path: 'settings', element: null },
          { path: '*', element: null },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return within(screen.getByRole('navigation', { name: 'Main' }));
}

describe('AppNav current section', () => {
  it('marks only the open section with the pill and bold weight', () => {
    const nav = renderAt('/library');
    const marked = nav
      .getAllByRole('link')
      .filter((l) => l.querySelector('[data-indicator]') !== null);
    expect(marked.map((l) => l.textContent)).toEqual(['Library']);
    expect(marked[0]?.getAttribute('aria-current')).toBe('page');
    expect(marked[0]?.className).toContain('font-bold');
  });

  it.each([
    '/workshop',
    '/workshop/collection/abc',
    '/workshop/rules',
    '/homebrew',
  ])('names the Workshop, with its Hammer, the section open at %s', (path) => {
    const nav = renderAt(path);
    const current = nav.getAllByRole('link').filter((l) => l.getAttribute('aria-current'));
    expect(current.map((l) => [l.textContent, l.getAttribute('aria-current')])).toEqual([
      ['Workshop', 'page'],
    ]);
    expect(current[0]?.querySelector('[data-indicator]')).not.toBeNull();
    expect(current[0]?.querySelector('svg.lucide-hammer')).not.toBeNull();
    expect(current[0]?.getAttribute('href')).toBe('/workshop');
  });

  // The routes match regardless of case, as NavLink's tabs did.
  it.each([
    ['/Library', 'Library'],
    ['/WORKSHOP/Rules', 'Workshop'],
  ])('lights the tab at %s, whatever its case', (path, tab) => {
    const nav = renderAt(path);
    expect(
      nav
        .getAllByRole('link')
        .filter((l) => l.getAttribute('aria-current') === 'page')
        .map((l) => l.textContent),
    ).toEqual([tab]);
  });

  it('marks no tab on a page none of them is for', () => {
    const nav = renderAt('/settings-old');
    expect(nav.getAllByRole('link').filter((l) => l.getAttribute('aria-current'))).toEqual([]);
  });
});
