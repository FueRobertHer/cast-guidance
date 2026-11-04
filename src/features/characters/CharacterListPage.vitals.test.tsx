// @vitest-environment jsdom
// The roster's HP comes from the same derivation as the sheet, so a class file
// that has not arrived gave it the same wrong number: a healthy-looking line, on
// a d8. The row holds its placeholder until the file is here.
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { dataStatusStore } from '@/stores/dataStatus';
import { makeTestContext } from '../../../tests-fixtures/testWorld';

const live = vi.hoisted(() => ({ characters: [] as unknown[] }));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => ({ characters: live.characters, errors: [] }),
}));
vi.mock('@/data5e/hooks', () => ({
  useRegistryState: () => ({ registry: makeTestContext(), status: 'ready' }),
}));
vi.mock('@/data5e/engineAdapter', () => ({ engineContextFor: (r: unknown) => r }));
vi.mock('@/db/characterRepo', () => ({ characterRepo: {} }));
vi.mock('@/db/homebrewRepo', () => ({ homebrewRepo: {} }));

import { Component as CharacterListPage } from './CharacterListPage';

function hero(className: string): CharacterDoc {
  const doc = newCharacterDoc('c1', 'Aria', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
  doc.classes = [{ ref: { name: className, source: 'TST' }, levels: 1, hp: ['avg'] }];
  return doc;
}

function renderRoster(doc: CharacterDoc, phase: 'working' | 'done' | 'error') {
  live.characters = [doc];
  dataStatusStore.setState({ phase });
  const router = createMemoryRouter([{ path: '/', element: <CharacterListPage /> }]);
  render(<RouterProvider router={router} />);
}

const hpLine = () => screen.queryByText(/^\d+ \/ \d+ HP$/);

afterEach(() => {
  cleanup();
  live.characters = [];
  dataStatusStore.setState({ phase: 'idle' });
});

describe('the roster row', () => {
  it('shows numbers once the class file is here, download finished or not', () => {
    renderRoster(hero('Warrior'), 'working');
    expect(hpLine()).not.toBeNull();
  });

  it('draws no numbers for a class file still on its way', () => {
    renderRoster(hero('Not Here Yet'), 'working');
    expect(screen.getByText('Aria')).toBeTruthy();
    expect(hpLine()).toBeNull();
  });

  it('draws no numbers when the download stopped short of the class file', () => {
    renderRoster(hero('Not Here Yet'), 'error');
    expect(hpLine()).toBeNull();
  });

  it('says what the sheet says once nothing more can arrive', () => {
    renderRoster(hero('Removed Homebrew'), 'done');
    expect(hpLine()).not.toBeNull();
  });
});
