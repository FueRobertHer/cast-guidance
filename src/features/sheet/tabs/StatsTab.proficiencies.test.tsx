// @vitest-environment jsdom
// The Proficiencies line, from a character derived over the data's own strings:
// what a player reads, never the `{@tag}` or `name|source` markup behind it.
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { newCharacterDoc } from '@/engine/types';
import { makeProficiencyContext } from '../../../../tests-fixtures/proficiencyWorld';
import type { CharacterSheetState } from '../useCharacterSheet';
import { Component as StatsTab } from './StatsTab';

afterEach(cleanup);

/** The whole Proficiencies line of a character with `race` at level 2 of `cls`. */
function proficienciesLine(cls: { name: string; source: string }, race?: string): string {
  const doc = newCharacterDoc('c1', 'Hero', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 16 };
  doc.classes = [{ ref: cls, levels: 2, hp: ['avg', 'avg'] }];
  if (race !== undefined) doc.race = { name: race, source: 'PHB' };
  const sheet = deriveSheet(doc, makeProficiencyContext());
  const context = { doc, sheet, update: () => undefined } as unknown as CharacterSheetState;
  const router = createMemoryRouter([
    {
      path: '/',
      element: <Outlet context={context} />,
      children: [{ index: true, element: <StatsTab /> }],
    },
  ]);
  render(<RouterProvider router={router} />);
  return screen.getByText('Proficiencies:').parentElement?.textContent ?? '';
}

describe('the Proficiencies line on the Stats tab', () => {
  it('reads as words for a 2014 Bard', () => {
    const line = proficienciesLine({ name: 'Bard', source: 'PHB' });
    expect(line).not.toContain('{@');
    expect(line).toBe(
      'Proficiencies: light, simple, hand crossbows, longswords, rapiers, shortswords, three musical instruments of your choice',
    );
  });

  it('reads as words for a 2024 Monk, whose list has a filter in it', () => {
    const line = proficienciesLine({ name: 'Monk', source: 'XPHB' });
    expect(line).not.toContain('{@');
    expect(line).toContain('Martial weapons that have the Light property');
  });

  it('shows no source on a weapon a species names', () => {
    const line = proficienciesLine({ name: 'Mage', source: 'TST' }, 'Elf (High)');
    expect(line).not.toContain('|');
    expect(line).toBe('Proficiencies: Longsword, Shortsword, Shortbow, Longbow');
  });
});
