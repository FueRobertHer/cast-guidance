// @vitest-environment jsdom
// PWA-001: a character opened before the essentials pack ever downloaded, and
// offline, used to sit on "Deriving…" for good: the registry it derives from
// rejected and nothing said so. The layout now says why, and offers Retry.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dbLifecycleStore } from '@/stores/dbLifecycle';
import { Component as SheetLayout } from './SheetLayout';
import type { CharacterSheetState } from './useCharacterSheet';

const sheetState = vi.hoisted(() => ({ current: {} as Partial<CharacterSheetState> }));
vi.mock('./useCharacterSheet', () => ({ useCharacterSheet: () => sheetState.current }));
vi.mock('./useOpenElsewhere', () => ({ useOpenElsewhere: () => false }));
vi.mock('./HistoryDrawer', () => ({ HistoryDrawer: () => null }));
vi.mock('@/features/dice/DiceTray', () => ({ DiceTray: () => null }));
vi.mock('@/ui/AdvToggle', () => ({ AdvToggle: () => null }));

const retry = vi.fn();

function loaded(data: CharacterSheetState['data'], sheet: unknown = null) {
  sheetState.current = {
    loadStatus: 'ready',
    missing: false,
    error: null,
    saveStatus: 'idle',
    doc: { name: 'Hero' } as CharacterSheetState['doc'],
    sheet: sheet as CharacterSheetState['sheet'],
    data,
  };
}

function renderSheet() {
  const router = createMemoryRouter(
    [
      {
        path: '/c/:id',
        element: <SheetLayout />,
        children: [{ index: true, element: <p>tab content</p> }],
      },
    ],
    { initialEntries: ['/c/x'] },
  );
  render(<RouterProvider router={router} />);
}

beforeEach(() => retry.mockClear());

afterEach(() => {
  cleanup();
  dbLifecycleStore.setState({ state: 'open' });
  vi.restoreAllMocks();
});

describe('SheetLayout without game data', () => {
  it('says the data is not downloaded and the device is offline, with Retry', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    loaded({ status: 'error', error: 'Failed to fetch', retry });
    renderSheet();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(
      "You're offline, and the game data this needs isn't downloaded yet.",
    );
    expect(alert.textContent).toContain('Your character is saved on this device.');
    expect(alert.textContent).toContain("It downloads by itself once you're back online.");
    expect(screen.queryByText('tab content')).toBeNull();
    // The header still names the character.
    expect(screen.getByRole('heading', { level: 1, name: 'Hero' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('tries again by itself once the device is back online', () => {
    loaded({ status: 'error', error: 'Failed to fetch', retry });
    renderSheet();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(retry).toHaveBeenCalledOnce();
  });

  it('names the failure online', () => {
    loaded({ status: 'error', error: 'HTTP 503 for races.json', retry });
    renderSheet();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(
      "The game data this needs couldn't be downloaded: HTTP 503 for races.json",
    );
    // Online, the network is not what to wait for.
    expect(alert.textContent).toContain('Your character is saved on this device.');
    expect(alert.textContent).not.toContain('back online');
  });

  it('says only that the tab needs a reload when the database is closed', () => {
    dbLifecycleStore.setState({ state: 'deleted' });
    loaded({ status: 'error', error: 'Database has been closed', retry });
    renderSheet();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Reload this tab to load the game data.')).toBeTruthy();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(retry).not.toHaveBeenCalled();
  });

  it('leaves the tab to its own wait while the data is still coming', () => {
    loaded({ status: 'loading', error: null, retry });
    renderSheet();
    expect(screen.getByText('tab content')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a derived sheet on screen if a later refresh fails', () => {
    loaded({ status: 'error', error: 'HTTP 503', retry }, { classLabel: 'Fighter 1' });
    renderSheet();
    expect(screen.getByText('tab content')).toBeTruthy();
  });
});
