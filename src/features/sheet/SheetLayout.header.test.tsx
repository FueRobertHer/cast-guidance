// @vitest-environment jsdom
// UX-004: the sheet header sticks on top of the page, so a tab's own sticky bar
// (the build page's undo bar) has to sit under it. The header publishes its
// height for that; a bar at top-0 hid behind it once the page scrolled.
import { cleanup, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component as SheetLayout, useHeaderHeight } from './SheetLayout';

// The layout's own data comes from the session store and IndexedDB; a loaded
// character stands in, so the header and the tab bar are what is under test.
vi.mock('./useCharacterSheet', () => ({
  useCharacterSheet: () => ({
    loadStatus: 'ready',
    missing: false,
    error: null,
    saveStatus: 'saved',
    doc: { name: 'Hero' },
    sheet: { classLabel: 'Warrior 3' },
  }),
}));
vi.mock('./useOpenElsewhere', () => ({ useOpenElsewhere: () => false }));
vi.mock('./HistoryDrawer', () => ({ HistoryDrawer: () => null }));
vi.mock('@/features/dice/DiceTray', () => ({ DiceTray: () => null }));
vi.mock('@/ui/AdvToggle', () => ({ AdvToggle: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Probe() {
  const { header, style } = useHeaderHeight();
  return (
    <div data-testid="root" style={style}>
      <header ref={header}>Name</header>
    </div>
  );
}

describe('useHeaderHeight', () => {
  it('publishes the header height for a tab bar to stick under', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(68);
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('root').style.getPropertyValue('--sheet-header-h')).toBe('68px');
  });
});

describe('SheetLayout tab bar (A11Y-002)', () => {
  function renderAt(path: string) {
    const router = createMemoryRouter(
      [
        {
          path: '/c/:id',
          element: <SheetLayout />,
          children: [
            { index: true, element: null },
            { path: 'stats', element: null },
            { path: 'build', element: null },
          ],
        },
      ],
      { initialEntries: [path] },
    );
    render(<RouterProvider router={router} />);
    return within(screen.getByRole('navigation', { name: 'Character sheet' }));
  }

  it('marks the open tab with a bar as well as colour, and only that tab', () => {
    const nav = renderAt('/c/x/stats');
    const links = nav.getAllByRole('link');
    const marked = links.filter((l) => l.querySelector('[data-indicator]') !== null);
    expect(marked.map((l) => l.textContent)).toEqual(['Stats']);
    expect(marked[0]?.getAttribute('aria-current')).toBe('page');
    expect(marked[0]?.className).toContain('font-semibold');
  });

  it('gives the back link a full-size target', () => {
    renderAt('/c/x');
    const back = screen.getByRole('link', { name: 'Back to characters' });
    expect(back.className.split(' ')).toContain('tap');
  });
});
