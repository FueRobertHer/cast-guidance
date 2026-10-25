// @vitest-environment jsdom
// UX-002: where the getting-started card sits on the roster. On an empty
// roster it waits below the ways to make a character, so New character stays
// above the fold on a phone; above an existing roster it comes first. Hiding
// it returns focus to the page heading rather than dropping it to the body.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import { onboardingStore } from '@/stores/onboarding';

const list = vi.hoisted(() => ({ characters: [] as unknown[] }));

vi.mock('@/db/characterRepo', () => ({
  characterRepo: {
    listSafe: () => Promise.resolve({ characters: list.characters, errors: [] }),
  },
}));
// Dexie's live query needs a real database behind it; the roster only needs
// the one answer.
vi.mock('dexie-react-hooks', async () => {
  const { useEffect, useState } = await import('react');
  return {
    useLiveQuery: <T,>(query: () => Promise<T>) => {
      const [value, setValue] = useState<T>();
      useEffect(() => {
        void query().then(setValue);
      }, []);
      return value;
    },
  };
});
vi.mock('@/data5e/hooks', () => ({
  useRegistryState: () => ({ registry: null, status: 'loading' }),
}));

import { Component as CharacterListPage } from './CharacterListPage';

function renderRoster() {
  return render(
    <MemoryRouter>
      <CharacterListPage />
    </MemoryRouter>,
  );
}

/** Whether `a` comes before `b` in document order. */
function precedes(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

afterEach(() => {
  cleanup();
  list.characters = [];
  localStorage.clear();
  onboardingStore.setState({ dismissed: false });
});

describe('CharacterListPage getting-started card', () => {
  it('sits below New character on an empty roster', async () => {
    renderRoster();
    const card = await screen.findByRole('region', { name: 'Getting started' });
    const create = screen.getByRole('heading', { name: 'New character' });
    expect(precedes(create, card)).toBe(true);
  });

  it('comes before an existing roster', async () => {
    list.characters = [newCharacterDoc('a', 'Aria', 'v2.32.0')];
    renderRoster();
    const card = await screen.findByRole('region', { name: 'Getting started' });
    expect(precedes(card, screen.getByRole('link', { name: /Aria/ }))).toBe(true);
  });

  it('hands focus to the page heading when hidden', async () => {
    renderRoster();
    fireEvent.click(await screen.findByRole('button', { name: 'Got it, hide this' }));
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Characters' }));
  });
});
