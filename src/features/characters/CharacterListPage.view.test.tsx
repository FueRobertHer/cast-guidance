// @vitest-environment jsdom
// The roster derives each character's HP through that character's own view of
// the registry (ADR-002, D3): Hild, with Changes to the books off, has the
// book's Rage, and Maren the change that gives 2 more HP a level.
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { mergeHomebrew, normalizeDataset } from '@/data5e/normalize';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { writeChange } from '@/features/workshop/copyWriter';
import { dataStatusStore } from '@/stores/dataStatus';

const live = vi.hoisted(() => ({ characters: [] as unknown[], registry: null as unknown }));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => ({ characters: live.characters, errors: [] }),
}));
vi.mock('@/data5e/hooks', () => ({
  useRegistryState: () => ({ registry: live.registry, status: 'ready' }),
}));
vi.mock('@/db/characterRepo', () => ({ characterRepo: {} }));
vi.mock('@/db/homebrewRepo', () => ({ homebrewRepo: {} }));

import { Component as CharacterListPage } from './CharacterListPage';

const RELEASE = new Map<string, unknown>([
  [
    'class/class-barbarian.json',
    {
      class: [
        {
          name: 'Barbarian',
          source: 'XPHB',
          edition: 'one',
          hd: { number: 1, faces: 12 },
          proficiency: ['str', 'con'],
          classFeatures: ['Rage|Barbarian|XPHB|1'],
        },
      ],
      classFeature: [
        {
          name: 'Rage',
          source: 'XPHB',
          className: 'Barbarian',
          classSource: 'XPHB',
          level: 1,
          entries: ['You can imbue yourself with a primal power called Rage.'],
        },
      ],
    },
  ],
]);

function registryWithChange() {
  const reg = normalizeDataset(RELEASE);
  const rage = structuredClone(reg.byType('classFeature').find((f) => f.name === 'Rage') as Entity);
  const change = writeChange('classFeature', rage, {
    ...rage,
    castGuidance: { v: 1, effects: [{ kind: 'hpPerLevel', amount: 2 }] },
  });
  mergeHomebrew(
    reg,
    new Map([
      [
        'changes',
        { _meta: { sources: [{ json: 'MyChanges' }] }, classFeature: [change] } as Record<
          string,
          unknown
        >,
      ],
    ]),
    new Map(),
    new Set(['changes']),
  );
  return reg;
}

function barbarian(id: string, name: string, edit: (d: CharacterDoc) => void = () => undefined) {
  const doc = newCharacterDoc(id, name, 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 };
  doc.classes = [{ ref: { name: 'Barbarian', source: 'XPHB' }, levels: 1, hp: ['avg'] }];
  doc.play.currentHp = 10;
  edit(doc);
  return doc;
}

afterEach(() => {
  cleanup();
  live.characters = [];
  dataStatusStore.setState({ phase: 'idle' });
});

/** Each row's HP line, in the roster's order. */
const hpLines = () => screen.getAllByText(/^\d+ \/ \d+ HP$/).map((e) => e.textContent);

describe('the roster’s HP', () => {
  it('reads each character’s own view: Hild has the book’s Rage, Maren the change', () => {
    live.registry = registryWithChange();
    live.characters = [
      barbarian('hild', 'Hild', (d) => {
        d.sourceSwitches = { off: ['MyChanges'] };
      }),
      barbarian('maren', 'Maren'),
    ];
    dataStatusStore.setState({ phase: 'done' });
    render(
      <RouterProvider
        router={createMemoryRouter([{ path: '/', element: <CharacterListPage /> }])}
      />,
    );
    // d12 at level 1 with Constitution 14: 14; the change adds 2.
    expect(screen.getByText('Hild')).toBeTruthy();
    expect(hpLines()).toEqual(['10 / 14 HP', '10 / 16 HP']);
  });
});
