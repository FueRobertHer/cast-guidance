// @vitest-environment jsdom
// UX-003: each creator step is its own history entry, and creating used to
// replace only the last one. Back from the new sheet then landed in the
// creator with its draft already spent, one tap from a second, empty
// character. The creator also had no way out while game data loaded, and its
// way out elsewhere was an icon with no name.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import { namelessControls } from '../../../tests-fixtures/a11y';
import { makeTestContext } from '../../../tests-fixtures/testWorld';

const { registry, put } = vi.hoisted(() => ({
  /** What `useRegistry` returns; null stands for game data still loading. */
  registry: { current: undefined as unknown, loading: false },
  put: vi.fn(),
}));

vi.mock('@/data5e/hooks', () => ({
  useRegistry: () => (registry.loading ? null : registry.current),
}));
vi.mock('@/data5e/loader', () => ({ ensureTypePacks: () => Promise.resolve() }));
vi.mock('@/db/characterRepo', () => ({ characterRepo: { put } }));

import { noticeStore } from '@/stores/notices';
import { Component as CreatorPage } from './CreatorPage';
import { wizardState } from './steps';

registry.current = makeTestContext();

const DRAFT_KEY = 'cast-guidance:creator-draft';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  registry.loading = false;
  put.mockReset();
  noticeStore.setState({ notice: null, seq: 0 });
  document.title = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Entry = string | { pathname: string; search?: string; state?: unknown };

function renderCreator(entries: Entry[], index = entries.length - 1) {
  // A data router: only its navigate reports when a pop has landed.
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Roster</p> },
      { path: '/create', element: <CreatorPage /> },
      { path: '/c/:id', element: <p>Sheet</p> },
    ],
    { initialEntries: entries, initialIndex: index },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** Entered from the roster and walked to Review, the way a player gets there. */
const walkedToReview: Entry[] = [
  '/',
  '/create',
  { pathname: '/create', search: '?step=class', state: wizardState(1) },
  { pathname: '/create', search: '?step=review', state: wizardState(2) },
];

function seedDraft() {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(newCharacterDoc('hero-1', 'Aria', 't')));
}

describe('stepping through the creator', () => {
  it('records how deep into the wizard each step push is', async () => {
    const router = renderCreator(['/', '/create']);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?step=class'));
    expect(router.state.location.state).toEqual(wizardState(1));

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?step=species'));
    expect(router.state.location.state).toEqual(wizardState(2));
  });

  it('pushes once for a double tap that lands before the first push commits', async () => {
    const router = renderCreator(['/', '/create']);
    const next = screen.getByRole('button', { name: /Next/ });
    act(() => {
      next.click();
      next.click();
    });
    await waitFor(() => expect(router.state.location.search).toBe('?step=class'));
    await act(() => router.navigate(-1));
    // One entry above the one the wizard was entered on, not two.
    expect(router.state.location.search).toBe('');
  });

  it('lets the steps move again after a Back that beat the push', async () => {
    let now = 1_000_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const router = renderCreator(['/', '/create']);
    await act(async () => {
      screen.getByRole('button', { name: /Next/ }).click();
      await router.navigate(-1);
    });
    // Back on the entry the push left from, under its old key. A guard that
    // waited for a new entry would hold Next here for good.
    now += 1000;
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?step=class'));
  });

  it('names the step in the document title', () => {
    renderCreator(walkedToReview);
    expect(document.title).toBe('Review · Step 9 of 9 · New character · Cast Guidance');
  });
});

describe('creating a character', () => {
  it('leaves the wizard behind, so Back from the sheet goes to the roster', async () => {
    seedDraft();
    put.mockResolvedValue(undefined);
    const router = renderCreator(walkedToReview);

    fireEvent.click(screen.getByRole('button', { name: /Create character/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/hero-1'));
    expect(put).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText('Roster')).toBeTruthy();
  });

  it('creates once and unwinds once, however many times Create is pressed', async () => {
    seedDraft();
    let finish: () => void = () => undefined;
    put.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const router = renderCreator(walkedToReview);

    // Both taps inside one batch, so the second runs before the re-render
    // that takes the button away.
    const create = screen.getByRole('button', { name: /Create character/ });
    act(() => {
      create.click();
      create.click();
    });
    // The wizard is spent the moment Create is pressed: nothing on it can be
    // pressed again, and a save that settles quickly offers no way off it.
    expect(screen.getByRole('status').textContent).toContain('Opening Aria');
    expect(screen.queryByRole('button', { name: /Next|Back|Create/ })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();

    finish();
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/hero-1'));
    expect(put).toHaveBeenCalledOnce();
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/');
  });

  it('just replaces its own entry when the depth it holds is from before a reload', async () => {
    seedDraft();
    put.mockResolvedValue(undefined);
    // History state outlives a reload; the entries it counted do not.
    const router = renderCreator([
      '/',
      '/create',
      { pathname: '/create', search: '?step=review', state: { creatorDepth: 1, creatorLoad: 'x' } },
    ]);

    fireEvent.click(screen.getByRole('button', { name: /Create character/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/hero-1'));
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/create');
  });

  it('offers a way out of a save that looks stuck, and opens nothing after it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    seedDraft();
    let finish: () => void = () => undefined;
    put.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const router = renderCreator(walkedToReview);

    fireEvent.click(screen.getByRole('button', { name: /Create character/ }));
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.click(screen.getByRole('link', { name: /Back to characters/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await act(async () => finish());
    expect(put).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText('Roster')).toBeTruthy();
  });

  it('keeps the wizard and says so when the save is refused', async () => {
    seedDraft();
    put.mockRejectedValue(new Error('QuotaExceededError'));
    const router = renderCreator(walkedToReview);

    fireEvent.click(screen.getByRole('button', { name: /Create character/ }));
    await waitFor(() => expect(noticeStore.getState().notice?.title).toBe('Create failed'));
    expect(router.state.location.search).toBe('?step=review');
    expect(sessionStorage.getItem(DRAFT_KEY)).not.toBeNull();
    // And Create can be pressed again.
    expect(screen.getByRole('button', { name: /Create character/ })).toBeTruthy();
  });
});

describe('the way out', () => {
  it('is there, and named, while game data is still loading', () => {
    registry.loading = true;
    renderCreator(['/', '/create']);
    expect(screen.getByText('Loading game data…')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Back to characters/ }).getAttribute('href')).toBe('/');
  });

  it('is named on every step', () => {
    renderCreator(['/', '/create']);
    expect(screen.getByRole('link', { name: /Back to characters/ }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('heading', { name: 'Basics' })).toBeTruthy();
  });
});

// A11Y-001: the point-buy and level steppers were bare "−" and "+" glyphs (the
// level pair sat in a <label> that named the minus "Level" and left the plus
// nameless), and the segmented picks showed their state only by colour.
describe('accessible names and states', () => {
  /** A draft with a class picked and point buy chosen, opened on `step`. */
  function renderStep(step: string) {
    const doc = newCharacterDoc('hero-1', 'Aria', 't');
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 1, hp: ['avg'] }];
    doc.abilities.method = 'pointbuy';
    doc.abilities.base = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(doc));
    renderCreator(['/', { pathname: '/create', search: `?step=${step}`, state: wizardState(1) }]);
  }

  it('names the level steppers apart from the label beside them', () => {
    renderStep('class');
    expect(namelessControls()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Increase level' }));
    expect(
      screen.getByText('Level', { selector: '[aria-live] *' }).parentElement?.textContent,
    ).toBe('Level 2');
    expect(screen.getByRole('button', { name: 'Decrease level' })).toBeTruthy();
  });

  it('names the point-buy steppers and says which method is in use', () => {
    renderStep('abilities');
    expect(namelessControls()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Increase str' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^\d+ pending decisions: go to the Choices step$/ }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Point buy', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manual', pressed: false })).toBeTruthy();
  });

  it('says which rules version is picked', () => {
    renderStep('basics');
    expect(screen.getByRole('button', { name: /^Classic/, pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Revised/, pressed: false })).toBeTruthy();
  });
});
