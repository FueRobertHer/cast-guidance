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

registry.current = makeTestContext();

const DRAFT_KEY = 'cast-guidance:creator-draft';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  registry.loading = false;
  put.mockReset();
  noticeStore.setState({ notice: null, seq: 0 });
  document.title = '';
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
  { pathname: '/create', search: '?step=class', state: { creatorDepth: 1 } },
  { pathname: '/create', search: '?step=review', state: { creatorDepth: 2 } },
];

function seedDraft() {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(newCharacterDoc('hero-1', 'Aria', 't')));
}

describe('stepping through the creator', () => {
  it('records how deep into the wizard each step push is', async () => {
    const router = renderCreator(['/', '/create']);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?step=class'));
    expect(router.state.location.state).toEqual({ creatorDepth: 1 });

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?step=species'));
    expect(router.state.location.state).toEqual({ creatorDepth: 2 });
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

    const create = screen.getByRole('button', { name: /Create character/ });
    fireEvent.click(create);
    fireEvent.click(create);
    // The wizard is spent the moment Create is pressed; nothing on it can be
    // pressed again, including the way out.
    expect(screen.getByRole('status').textContent).toContain('Opening Aria');
    expect(screen.queryByRole('link', { name: /Back to characters/ })).toBeNull();

    finish();
    await waitFor(() => expect(router.state.location.pathname).toBe('/c/hero-1'));
    expect(put).toHaveBeenCalledOnce();
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/');
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
