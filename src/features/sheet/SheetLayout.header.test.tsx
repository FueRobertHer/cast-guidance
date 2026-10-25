// @vitest-environment jsdom
// UX-004: the sheet header sticks on top of the page, so a tab's own sticky bar
// (the build page's undo bar) has to sit under it. The header publishes its
// height for that; a bar at top-0 hid behind it once the page scrolled.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetAnnouncer } from '@/stores/announcer';
import { listenForAnnouncements } from '../../../tests-fixtures/announcements';
import { OPEN_ELSEWHERE_TEXT, Component as SheetLayout, useHeaderHeight } from './SheetLayout';

// The layout's own data comes from the session store and IndexedDB; a loaded
// character stands in, so the header and the tab bar are what is under test.
// Its save status and the other-tab flag are settable, for the announcement tests.
const sheetState = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { saveStatus: 'saved', openElsewhere: false };
  return {
    state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(next: Partial<typeof state>) {
      Object.assign(state, next);
      for (const fn of listeners) fn();
    },
  };
});
vi.mock('./useCharacterSheet', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useCharacterSheet: () => ({
      loadStatus: 'ready',
      missing: false,
      error: null,
      saveStatus: useSyncExternalStore(sheetState.subscribe, () => sheetState.state.saveStatus),
      doc: { name: 'Hero' },
      sheet: { classLabel: 'Warrior 3' },
    }),
  };
});
vi.mock('./useOpenElsewhere', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useOpenElsewhere: () =>
      useSyncExternalStore(sheetState.subscribe, () => sheetState.state.openElsewhere),
  };
});
vi.mock('./HistoryDrawer', () => ({ HistoryDrawer: () => null }));
vi.mock('@/features/dice/DiceTray', () => ({ DiceTray: () => null }));
vi.mock('@/ui/AdvToggle', () => ({ AdvToggle: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetAnnouncer();
  sheetState.set({ saveStatus: 'saved', openElsewhere: false });
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

// A11Y-002: the save indicator is a visual. As a live region it said Unsaved,
// Saving and Saved for every HP tap; failures are the shell's to say.
describe('SheetLayout announcements (A11Y-002)', () => {
  function renderSheet() {
    const router = createMemoryRouter(
      [{ path: '/c/:id', element: <SheetLayout />, children: [{ index: true, element: null }] }],
      { initialEntries: ['/c/x'] },
    );
    render(<RouterProvider router={router} />);
  }

  it('cycles the save indicator without saying a word', () => {
    renderSheet();
    const listener = listenForAnnouncements();
    const seen: string[] = [];
    for (const status of ['pending', 'saving', 'saved', 'pending', 'saving', 'error', 'saved']) {
      act(() => sheetState.set({ saveStatus: status }));
      seen.push(document.querySelector('[data-save-indicator]')?.textContent?.trim() ?? '');
    }
    listener.stop();
    // The text does change, on screen.
    expect(seen).toEqual([
      'Unsaved',
      'Saving',
      'Saved',
      'Unsaved',
      'Saving',
      'Save failed',
      'Saved',
    ]);
    expect(listener.heard).toEqual([]);
    const indicator = document.querySelector('[data-save-indicator]');
    expect(indicator?.getAttribute('aria-live')).toBeNull();
    expect(indicator?.closest('[aria-live],[role="status"],[role="alert"],output')).toBeNull();
  });

  it('says once that the character is open in another tab, from a plain banner', () => {
    renderSheet();
    const listener = listenForAnnouncements();
    act(() => sheetState.set({ openElsewhere: true }));
    // Any later render of the sheet leaves it said once.
    act(() => sheetState.set({ saveStatus: 'pending' }));
    listener.stop();
    expect(listener.heard).toEqual([OPEN_ELSEWHERE_TEXT]);
    const banner = screen.getByText(OPEN_ELSEWHERE_TEXT);
    expect(banner.closest('[aria-live],[role="status"],[role="alert"],output')).toBeNull();
  });
});
