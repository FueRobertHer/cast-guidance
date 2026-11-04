// @vitest-environment jsdom
// UX-001: a draft left in the wizard was invisible from the roster. The only
// way back was the wizard tile, and the only way to drop it was to close the
// tab, so the roster now names it and offers Resume and Discard.
// DS-001: the roster's card is one link with its actions beside it, and one
// primary New character holds both ways to make a character.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { LONG_PRESS_MS } from '@/lib/useLongPress';
import { askChoice } from '@/ui/dialogs';
import { namelessControls } from '../../../tests-fixtures/a11y';

const live = vi.hoisted(() => ({ characters: [] as unknown[] }));
const repo = vi.hoisted(() => ({ put: vi.fn(() => Promise.resolve()) }));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => ({ characters: live.characters, errors: [] }),
}));
vi.mock('@/data5e/hooks', () => ({
  useRegistryState: () => ({ registry: null, status: 'loading' }),
}));
vi.mock('@/db/characterRepo', () => ({ characterRepo: repo }));
vi.mock('@/db/homebrewRepo', () => ({ homebrewRepo: {} }));
vi.mock('@/ui/dialogs', () => ({
  askChoice: vi.fn(),
  askConfirm: vi.fn(),
  askText: vi.fn(),
}));

import { readDraft, writeDraft } from '@/features/creator/draft';
import { Component as CharacterListPage } from './CharacterListPage';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  live.characters = [];
  vi.mocked(askChoice).mockReset();
  repo.put.mockClear();
  vi.useRealTimers();
});

// One doc copied, so its timestamps match wherever it is compared.
const ARIA: CharacterDoc = (() => {
  const doc = newCharacterDoc('hero-1', 'Aria', 't');
  doc.classes = [{ ref: { name: 'Fighter', source: 'TST' }, levels: 3, hp: ['avg'] }];
  doc.race = { name: 'Elf', source: 'TST' };
  return doc;
})();

function seedAria() {
  writeDraft(
    { doc: structuredClone(ARIA), bundleChoices: { 'class:0': 'b' }, slotPicks: {} },
    'abilities',
  );
}

function renderRoster() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <CharacterListPage /> },
      { path: '/create', element: <p>Creator</p> },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** A finger (or a mouse) going down on `el`, at the origin. */
function press(el: Element, pointerType = 'touch') {
  fireEvent.pointerDown(el, { pointerType, isPrimary: true, clientX: 0, clientY: 0 });
}

describe('New character', () => {
  it('is the one primary action, and asks which way to make the character', async () => {
    const router = renderRoster();
    const create = screen.getByRole('button', { name: 'New character' });
    expect(create.getAttribute('aria-haspopup')).toBe('dialog');

    vi.mocked(askChoice).mockResolvedValueOnce('wizard');
    fireEvent.click(create);
    expect(vi.mocked(askChoice).mock.calls[0]?.[0]).toEqual({
      title: 'New character',
      options: [
        { id: 'wizard', label: 'Guided wizard', hint: 'Step by step' },
        { id: 'blank', label: 'Blank sheet', hint: 'Change anything' },
      ],
    });
    await screen.findByText('Creator');
    expect(router.state.location.pathname).toBe('/create');
  });

  it('makes a blank sheet and opens it in Build', async () => {
    const router = createMemoryRouter(
      [
        { path: '/', element: <CharacterListPage /> },
        { path: '/c/:id/build', element: <p>Build</p> },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    vi.mocked(askChoice).mockResolvedValueOnce('blank');
    fireEvent.click(screen.getByRole('button', { name: 'New character' }));
    await screen.findByText('Build');
    expect(repo.put).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toMatch(/^\/c\/[^/]+\/build$/);
  });

  it('makes nothing when the choice is dismissed', async () => {
    const router = renderRoster();
    vi.mocked(askChoice).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: 'New character' }));
    await waitFor(() => expect(askChoice).toHaveBeenCalledOnce());
    expect(repo.put).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('a character card', () => {
  it('says a species and a missing class as a phrase', () => {
    live.characters = [{ ...ARIA, classes: [] }];
    renderRoster();
    expect(screen.getByRole('link', { name: /^Aria\b/ }).textContent).toContain(
      'Elf, no class yet',
    );
  });

  it('is one link to the character, with its actions as a button beside it', () => {
    live.characters = [ARIA];
    renderRoster();
    expect(namelessControls()).toEqual([]);
    const link = screen.getByRole('link', { name: /^Aria\b/ });
    expect(link.getAttribute('href')).toBe('/c/hero-1');
    expect(link.textContent).toContain('Elf Fighter 3');
    const actions = screen.getByRole('button', { name: 'Actions for Aria' });
    // Never inside the link: a button in a link is two controls in one.
    expect(link.contains(actions)).toBe(false);
    expect(actions.closest('a')).toBeNull();

    fireEvent.click(actions);
    expect(vi.mocked(askChoice).mock.calls[0]?.[0]).toMatchObject({ title: 'Aria' });
  });

  it('opens its actions on a long press, without opening the character', () => {
    vi.useFakeTimers();
    live.characters = [ARIA];
    const router = renderRoster();
    const link = screen.getByRole('link', { name: /^Aria\b/ });
    const actions = screen.getByRole('button', { name: 'Actions for Aria' });

    press(link);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 1));
    expect(askChoice).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(vi.mocked(askChoice).mock.calls[0]?.[0]).toMatchObject({ title: 'Aria' });
    // The sheet will hand focus back to the button the hold stands in for.
    expect(document.activeElement).toBe(actions);

    // The lift's click is not a tap on the card.
    fireEvent.pointerUp(link);
    fireEvent.click(link, { detail: 1 });
    expect(router.state.location.pathname).toBe('/');

    // The next tap is.
    press(link);
    fireEvent.pointerUp(link);
    fireEvent.click(link, { detail: 1 });
    expect(router.state.location.pathname).toBe('/c/hero-1');
  });
});

describe('the unfinished draft card', () => {
  it('names the draft and resumes it on the step it was left on', async () => {
    seedAria();
    const router = renderRoster();
    expect(screen.getByText('Unfinished character: Aria (Fighter 3, Elf)')).toBeTruthy();
    expect(namelessControls()).toEqual([]);
    const resume = screen.getByRole('link', { name: 'Resume' });
    expect(resume.getAttribute('href')).toBe('/create?step=abilities');

    fireEvent.click(resume);
    await screen.findByText('Creator');
    // The player chose to resume, so the wizard need not say it is continuing.
    expect(router.state.location.state).toEqual({ creatorResume: true });
  });

  it('discards the draft with an undo that puts all of it back', () => {
    seedAria();
    const before = readDraft();
    renderRoster();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(readDraft()).toBeNull();
    expect(screen.queryByText(/Unfinished character/)).toBeNull();
    expect(screen.getAllByRole('status').map((s) => s.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Discarded draft Aria')]),
    );
    // Discard went with its card; focus goes to the undo, not the page body.
    const undoButton = screen.getByRole('button', { name: 'Undo: Discarded draft Aria' });
    expect(document.activeElement).toBe(undoButton);

    fireEvent.click(undoButton);
    expect(readDraft()).toEqual(before);
    expect(screen.getByText('Unfinished character: Aria (Fighter 3, Elf)')).toBeTruthy();
  });

  it('is not there without a draft, or for one with nothing in it', () => {
    renderRoster();
    expect(screen.queryByText(/Unfinished character/)).toBeNull();
    // No undo line, the only status region the roster mounts; the import
    // line is a plain visual (A11Y-002), and empty.
    expect(screen.queryAllByRole('status')).toHaveLength(0);
    expect(document.querySelector('[data-import-status]')?.textContent).toBe('');
    cleanup();

    writeDraft({ doc: newCharacterDoc('hero-2', '', 't'), bundleChoices: {}, slotPicks: {} });
    renderRoster();
    expect(screen.queryByText(/Unfinished character/)).toBeNull();
    expect(screen.getByRole('button', { name: 'New character' })).toBeTruthy();
  });
});
