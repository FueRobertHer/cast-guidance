// @vitest-environment jsdom
// UX-004: the sheet header sticks on top of the page, so a tab's own sticky bar
// (the build page's undo bar) has to sit under it. The header publishes its
// height for that; a bar at top-0 hid behind it once the page scrolled.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStickyHeight } from '@/lib/useStickyHeight';
import { resetAnnouncer } from '@/stores/announcer';
import { listenForAnnouncements } from '../../../tests-fixtures/announcements';
import { OPEN_ELSEWHERE_TEXT, Component as SheetLayout } from './SheetLayout';

// The layout's own data comes from the session store and IndexedDB; a loaded
// character stands in, so the header and the tab bar are what is under test.
// Its save status and the other-tab flag are settable, for the announcement
// tests, and so are its pending choices, species, spellcasting and conditions.
const sheetState = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const initial = {
    saveStatus: 'saved',
    openElsewhere: false,
    pending: 0,
    casts: false,
    race: undefined as string | undefined,
    conditions: [] as { id: string; level?: number }[],
  };
  const state = { ...initial };
  // Bumped on every change, so the mocked hook below re-renders for any field.
  let version = 0;
  return {
    state,
    version: () => version,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(next: Partial<typeof state>) {
      Object.assign(state, next);
      version++;
      for (const fn of listeners) fn();
    },
    reset() {
      Object.assign(state, initial);
    },
  };
});
vi.mock('./useCharacterSheet', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useCharacterSheet: () => ({
      _version: useSyncExternalStore(sheetState.subscribe, sheetState.version),
      loadStatus: 'ready',
      missing: false,
      error: null,
      data: { status: 'ready', error: null, retry: () => undefined },
      saveStatus: useSyncExternalStore(sheetState.subscribe, () => sheetState.state.saveStatus),
      doc: {
        id: 'x',
        name: 'Hero',
        race: sheetState.state.race === undefined ? undefined : { name: sheetState.state.race },
        rulesVersion: '2024',
        play: { conditions: sheetState.state.conditions },
      },
      sheet: {
        classLabel: 'Warrior 3',
        pending: Array.from({ length: sheetState.state.pending }, (_, i) => ({ id: `p${i}` })),
        spellcasting: sheetState.state.casts ? [{ classUid: 'c' }] : [],
      },
    }),
  };
});
const actions = vi.hoisted(() => ({
  confirmDeleteCharacter: vi.fn(async () => true),
  deleteCharacter: vi.fn(async () => undefined),
  exportCharacter: vi.fn(async () => undefined),
}));
vi.mock('../characters/characterActions', () => actions);
vi.mock('./useOpenElsewhere', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useOpenElsewhere: () =>
      useSyncExternalStore(sheetState.subscribe, () => sheetState.state.openElsewhere),
  };
});
vi.mock('./HistoryDrawer', () => ({
  HistoryDrawer: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="History" /> : null,
}));
vi.mock('@/features/dice/DiceTray', () => ({ DiceTray: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetAnnouncer();
  sheetState.reset();
  for (const fn of Object.values(actions)) fn.mockClear();
});

function Probe() {
  const header = useStickyHeight('--sheet-header-h');
  return <header ref={header}>Name</header>;
}

const rootVar = () => document.documentElement.style.getPropertyValue('--sheet-header-h');

describe('useStickyHeight', () => {
  it('publishes the header height for a tab bar to stick under', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(68);
    render(<Probe />);
    // On the root, where the page's scroll padding reads it too (A11Y-003).
    expect(rootVar()).toBe('68px');
  });

  it('takes it back when the header goes', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(68);
    const { unmount } = render(<Probe />);
    unmount();
    expect(rootVar()).toBe('');
  });

  it('leaves a value another bar has set since', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(68);
    const { unmount } = render(<Probe />);
    document.documentElement.style.setProperty('--sheet-header-h', '90px');
    unmount();
    expect(rootVar()).toBe('90px');
    document.documentElement.style.removeProperty('--sheet-header-h');
  });

  it('is published by the sheet layout', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(58);
    const router = createMemoryRouter(
      [{ path: '/c/:id', element: <SheetLayout />, children: [{ index: true, element: null }] }],
      { initialEntries: ['/c/x'] },
    );
    render(<RouterProvider router={router} />);
    expect(rootVar()).toBe('58px');
  });
});

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Roster</p> },
      {
        path: '/c/:id',
        element: <SheetLayout />,
        children: [
          { index: true, element: null },
          { path: 'stats', element: null },
          { path: 'spells', element: null },
          { path: 'inventory', element: null },
          { path: 'features', element: null },
          { path: 'build', element: null },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const tabBar = () => within(screen.getByRole('navigation', { name: 'Character sheet' }));
const editLink = () => screen.getByRole('link', { name: /^Edit character/ });

describe('SheetLayout tab bar (A11Y-002)', () => {
  it('marks the open tab with a pill and weight as well as colour, and only that tab', () => {
    renderAt('/c/x/stats');
    const nav = tabBar();
    const links = nav.getAllByRole('link');
    const marked = links.filter((l) => l.querySelector('[data-indicator]') !== null);
    expect(marked.map((l) => l.textContent)).toEqual(['Stats']);
    expect(marked[0]?.getAttribute('aria-current')).toBe('page');
    expect(marked[0]?.className).toContain('font-bold');
  });

  it('has a heading that focus can land on once a save conflict is resolved', () => {
    renderAt('/c/x');
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.id).toBe('sheet-title');
    expect(heading.tabIndex).toBe(-1);
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
    for (const status of [
      'pending',
      'saving',
      'saved',
      'pending',
      'saving',
      'error',
      'conflict',
      'saved',
    ]) {
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
      'Not saved',
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

// The design system's sheet: five tabs, with Build behind the header's Edit.
describe('SheetLayout tabs (design system)', () => {
  const labels = () =>
    tabBar()
      .getAllByRole('link')
      .map((l) => l.textContent);

  it('lists the five tabs in order for a caster, with Build not among them', () => {
    sheetState.set({ casts: true });
    renderAt('/c/x');
    expect(labels()).toEqual(['Play', 'Stats', 'Spells', 'Items', 'Features']);
  });

  it('hides Spells for a character with no spellcasting', () => {
    renderAt('/c/x');
    expect(labels()).toEqual(['Play', 'Stats', 'Items', 'Features']);
  });

  it("still shows where a link straight to a non-caster's Spells landed", () => {
    renderAt('/c/x/spells');
    expect(labels()).toEqual(['Play', 'Stats', 'Spells', 'Items', 'Features']);
    expect(tabBar().getByRole('link', { name: 'Spells' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('marks no tab current on Build, and Edit instead', () => {
    renderAt('/c/x/build');
    for (const link of tabBar().getAllByRole('link')) {
      expect(link.getAttribute('aria-current'), link.textContent ?? '').toBeNull();
    }
    expect(editLink().getAttribute('aria-current')).toBe('page');
  });
});

describe('SheetLayout header (design system)', () => {
  it('opens Build from Edit, from any tab', async () => {
    const router = renderAt('/c/x/inventory');
    expect(editLink().getAttribute('href')).toBe('/c/x/build');
    expect(editLink().getAttribute('aria-current')).toBeNull();
    fireEvent.click(editLink());
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/x/build'));
  });

  it('says the pending count in Edit, on screen and in its name', () => {
    renderAt('/c/x');
    expect(editLink().textContent).toBe('Edit');
    expect(editLink().getAttribute('aria-label')).toBe('Edit character');

    act(() => sheetState.set({ pending: 2 }));
    expect(editLink().textContent).toBe('Edit2');
    expect(editLink().getAttribute('aria-label')).toBe('Edit character, 2 choices to make');

    act(() => sheetState.set({ pending: 1 }));
    expect(editLink().getAttribute('aria-label')).toBe('Edit character, 1 choice to make');
  });

  it('returns from Build to the tab Edit was pressed on, a step back through history', async () => {
    const router = renderAt('/c/x/stats');
    fireEvent.click(editLink());
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/x/build'));

    const back = screen.getByRole('link', { name: 'Back to Stats' });
    expect(back.getAttribute('href')).toBe('/c/x/stats');
    fireEvent.click(back);
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/x/stats'));
    expect(router.state.historyAction).toBe('POP');
  });

  it('keeps where Build came from when Edit is pressed again on Build', async () => {
    const router = renderAt('/c/x/features');
    fireEvent.click(editLink());
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/x/build'));
    fireEvent.click(editLink());
    await waitFor(() => expect(router.state.historyAction).toBe('REPLACE'));
    expect(screen.getByRole('link', { name: 'Back to Features' })).toBeTruthy();
  });

  it('goes up to the roster from Build opened from outside the sheet', async () => {
    const router = renderAt('/c/x/build');
    fireEvent.click(screen.getByRole('link', { name: 'Back to characters' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('puts species, class and level over the save state, which never truncates', () => {
    sheetState.set({ race: 'Dwarf' });
    renderAt('/c/x');
    const indicator = document.querySelector('[data-save-indicator]');
    const caption = indicator?.parentElement;
    expect(caption?.textContent).toBe('Dwarf Warrior 3·Saved');
    expect(caption?.querySelector('.truncate')?.textContent).toBe('Dwarf Warrior 3');
    expect(indicator?.className.split(' ')).toContain('shrink-0');
  });

  it('shows a failed save in danger', () => {
    sheetState.set({ saveStatus: 'error' });
    renderAt('/c/x');
    const indicator = document.querySelector('[data-save-indicator]');
    expect(indicator?.textContent).toBe('Save failed');
    expect(indicator?.className.split(' ')).toContain('text-danger');
  });

  it('keeps the save state in place, empty and hidden, before anything is saved', () => {
    sheetState.set({ race: 'Dwarf', saveStatus: 'idle' });
    renderAt('/c/x');
    // e2e waits on this element to say a save is over, so it is never removed.
    const indicator = document.querySelector('[data-save-indicator]');
    expect(indicator).not.toBeNull();
    expect(indicator?.childNodes).toHaveLength(0);
    expect(indicator?.className.split(' ')).toContain('empty:hidden');
    expect(indicator?.parentElement?.textContent).toBe('Dwarf Warrior 3');
  });
});

describe('SheetLayout condition strip (design system)', () => {
  const activeList = () => screen.queryByRole('list', { name: 'Active effects' });
  const addChip = () => screen.queryByRole('button', { name: 'Add an effect' });

  it('keeps active conditions in the header on every tab, and off Build', () => {
    sheetState.set({ conditions: [{ id: 'Poisoned' }] });
    for (const path of ['/c/x', '/c/x/stats', '/c/x/inventory', '/c/x/features']) {
      renderAt(path);
      const list = activeList();
      expect(list?.closest('header'), path).toBe(screen.getByRole('banner'));
      expect(within(list as HTMLElement).getByRole('button', { name: 'Poisoned' })).toBeTruthy();
      expect(addChip(), path).not.toBeNull();
      cleanup();
    }
    renderAt('/c/x/build');
    expect(activeList()).toBeNull();
    expect(addChip()).toBeNull();
  });

  it('leaves only the add chip when nothing is active, on every tab but Build', () => {
    for (const path of ['/c/x', '/c/x/stats', '/c/x/spells', '/c/x/inventory', '/c/x/features']) {
      renderAt(path);
      expect(activeList(), path).toBeNull();
      expect(addChip()?.closest('header'), path).toBe(screen.getByRole('banner'));
      cleanup();
    }
    renderAt('/c/x/build');
    expect(addChip()).toBeNull();
  });
});

describe('SheetLayout overflow menu', () => {
  const openMenu = () => {
    fireEvent.click(screen.getByRole('button', { name: 'More: history, export, delete' }));
    return within(screen.getByRole('menu'));
  };

  it('holds History, Export and Delete', () => {
    renderAt('/c/x');
    const menu = openMenu();
    expect(menu.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'History',
      'Export',
      'Delete',
    ]);
  });

  it('opens History from the menu', () => {
    renderAt('/c/x');
    fireEvent.click(openMenu().getByRole('menuitem', { name: 'History' }));
    expect(screen.getByRole('dialog', { name: 'History' })).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('exports the character on screen', async () => {
    renderAt('/c/x');
    fireEvent.click(openMenu().getByRole('menuitem', { name: 'Export' }));
    await waitFor(() =>
      expect(actions.exportCharacter).toHaveBeenCalledWith(expect.objectContaining({ id: 'x' })),
    );
  });

  it('deletes only once confirmed, then leaves for the roster', async () => {
    const router = renderAt('/c/x/stats');
    fireEvent.click(openMenu().getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(actions.confirmDeleteCharacter).toHaveBeenCalledWith('Hero');
    await waitFor(() => expect(actions.deleteCharacter).toHaveBeenCalledWith('x'));
    // Replaced, so Back from the roster does not reopen a deleted character.
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('keeps the character when the delete is cancelled', async () => {
    actions.confirmDeleteCharacter.mockResolvedValueOnce(false);
    const router = renderAt('/c/x');
    fireEvent.click(openMenu().getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(actions.confirmDeleteCharacter).toHaveBeenCalled());
    expect(actions.deleteCharacter).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/c/x');
  });
});
