// @vitest-environment jsdom
// UX-001: a draft left in the wizard was invisible from the roster. The only
// way back was the wizard tile, and the only way to drop it was to close the
// tab, so the roster now names it and offers Resume and Discard.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { namelessControls } from '../../../tests-fixtures/a11y';

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => ({ characters: [], errors: [] }),
}));
vi.mock('@/data5e/hooks', () => ({
  useRegistryState: () => ({ registry: null, status: 'loading' }),
}));
vi.mock('@/db/characterRepo', () => ({ characterRepo: {} }));
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
    expect(screen.getByRole('status').textContent).toContain('Discarded draft Aria');
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
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();

    writeDraft({ doc: newCharacterDoc('hero-2', '', 't'), bundleChoices: {}, slotPicks: {} });
    renderRoster();
    expect(screen.queryByText(/Unfinished character/)).toBeNull();
    expect(screen.getByRole('link', { name: /guided wizard/ })).toBeTruthy();
  });
});
