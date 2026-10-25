// @vitest-environment jsdom
// A11Y-001 on the Stats, Features and Spells tabs: ability buttons named only by
// a bare "+2" or "16", search fields named only by a placeholder, learn/prepare
// toggles with no state, and a recommended-pick star read as nothing at all.
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { newCharacterDoc } from '@/engine/types';
import { namelessControls } from '../../../../tests-fixtures/a11y';
import { makeTestContext } from '../../../../tests-fixtures/testWorld';
import type { CharacterSheetState } from '../useCharacterSheet';
import { Component as FeaturesTab } from './FeaturesTab';
import { Component as SpellsTab } from './SpellsTab';
import { Component as StatsTab } from './StatsTab';

vi.mock('@/data5e/hooks', () => ({
  useRegistry: () => makeTestContext(),
  useTypePacks: () => ({
    status: 'ready',
    error: null,
    offline: false,
    retry: () => undefined,
    repair: () => undefined,
  }),
}));
// No stored source policy: everything is browsable.
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => undefined }));
// The class spell list is a downloaded index; the two bolts stand in for it.
vi.mock('@/data5e/spellLookup', () => ({
  getSpellClassLookup: () => Promise.resolve({}),
  classSpellUids: () => new Set(['searing bolt|tst', 'quick bolt|tst']),
  classSpellUidsFromEntities: () => new Set(),
}));

afterEach(cleanup);

/** A level-5 sorcerer who knows and prepares Searing Bolt, on the given tab. */
function renderTab(tab: ReactElement) {
  const doc = newCharacterDoc('s1', 'Sparks', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 16 };
  doc.classes = [
    {
      ref: { name: 'Sorcerer', source: 'TST' },
      levels: 5,
      hp: ['avg', 'avg', 'avg', 'avg', 'avg'],
    },
  ];
  const bolt = { name: 'Searing Bolt', source: 'TST' };
  doc.spellcasting = { 'sorcerer|tst': { known: [bolt], prepared: [bolt] } };
  const context = {
    doc,
    sheet: deriveSheet(doc, makeTestContext()),
    update: () => undefined,
  } as unknown as CharacterSheetState;
  const router = createMemoryRouter([
    { path: '/', element: <Outlet context={context} />, children: [{ index: true, element: tab }] },
  ]);
  render(<RouterProvider router={router} />);
}

describe('sheet tab accessible names', () => {
  it('says what each ability button rolls or opens, not just the number', () => {
    renderTab(<StatsTab />);
    expect(namelessControls()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Roll CHA check (+3)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'CHA score 16: breakdown' })).toBeTruthy();
  });

  it('names the features filter', () => {
    renderTab(<FeaturesTab />);
    expect(namelessControls()).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'Filter features and traits' })).toBeTruthy();
  });

  it('names the spell search and each row toggle, and says which are on', async () => {
    renderTab(<SpellsTab />);
    expect(
      await screen.findByRole('button', { name: 'Learn Searing Bolt', pressed: true }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Prepare Searing Bolt', pressed: true }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Learn Quick Bolt', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cast Searing Bolt' })).toBeTruthy();
    expect(namelessControls()).toEqual([]);
  });
});
