// @vitest-environment jsdom
// Half proficiency (Jack of All Trades and the like) on the Stats tab: its own
// mark on the skills it reaches, and in the plain checks the tiles roll.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { type EffectInput, newCharacterDoc } from '@/engine/types';
import { rollLogStore } from '@/stores/rollLog';
import { makeTestContext } from '../../../../tests-fixtures/testWorld';
import type { CharacterSheetState } from '../useCharacterSheet';
import { Component as StatsTab } from './StatsTab';

vi.mock('@/data5e/hooks', () => ({ useRegistry: () => makeTestContext() }));

beforeAll(() => {
  // vaul asks for matchMedia, which jsdom does not have.
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

afterEach(() => {
  cleanup();
  rollLogStore.getState().clear();
});

/** A level-3 Warrior (proficiency +2, STR +2) with `customEffects`, on the Stats tab. */
function renderStats(customEffects: EffectInput[]) {
  const doc = newCharacterDoc('c1', 'Hero', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
  doc.choices = { 'class:warrior|tst:skill:0': ['Athletics', 'Intimidation'] };
  doc.customEffects = customEffects;
  const sheet = deriveSheet(doc, makeTestContext());
  const context = { doc, sheet, update: () => undefined } as unknown as CharacterSheetState;
  const router = createMemoryRouter([
    {
      path: '/',
      element: <Outlet context={context} />,
      children: [{ index: true, element: <StatsTab /> }],
    },
  ]);
  render(<RouterProvider router={router} />);
}

const jack = (skillsOnly?: true): EffectInput => ({
  origin: { label: 'Jack of All Trades', uid: 'bard|phb', type: 'class' },
  kind: 'halfProf',
  round: 'down',
  ...(skillsOnly ? { skillsOnly } : {}),
});

const row = (skill: string) => screen.getByRole('button', { name: new RegExp(skill) });

describe('half proficiency on the Stats tab', () => {
  it('marks the skills it reaches, and leaves proficient ones as they were', () => {
    renderStats([jack()]);
    expect(within(row('History')).getByText('half proficient')).toBeTruthy();
    expect(row('History').textContent).toMatch(/\+1$/);
    expect(within(row('Athletics')).getByText('proficient')).toBeTruthy();
    expect(row('Athletics').textContent).toMatch(/\+4$/);
  });

  it('shows no mark without it', () => {
    renderStats([]);
    expect(screen.queryAllByText('half proficient')).toEqual([]);
    expect(within(row('History')).getByText('not proficient')).toBeTruthy();
  });

  it('rolls plain checks with it, and marks the ability, under the 2014 wording', () => {
    renderStats([jack()]);
    // The six ability tiles, and the 16 skills outside Athletics and Intimidation.
    expect(screen.getAllByText('half proficient')).toHaveLength(6 + 16);
    fireEvent.click(screen.getByRole('button', { name: 'Roll STR check (+3)' }));
    expect(rollLogStore.getState().rolls[0]?.expr).toBe('1d20+3');
  });

  it('leaves plain checks alone under the 2024 wording', () => {
    renderStats([jack(true)]);
    expect(screen.getByRole('button', { name: 'Roll STR check (+2)' })).toBeTruthy();
    expect(screen.getAllByText('half proficient')).toHaveLength(16);
  });

  it('shows the check math in the score sheet when the tile is more than the modifier', async () => {
    renderStats([jack()]);
    fireEvent.click(screen.getByRole('button', { name: 'STR score 14: breakdown' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('STR check')).toBeTruthy();
    expect(within(sheet).getByText('Jack of All Trades')).toBeTruthy();
  });

  it('leaves the check out of the score sheet when the tile is the modifier', async () => {
    renderStats([jack(true)]);
    fireEvent.click(screen.getByRole('button', { name: 'STR score 14: breakdown' }));
    expect(within(await screen.findByRole('dialog')).queryByText('STR check')).toBeNull();
  });
});
