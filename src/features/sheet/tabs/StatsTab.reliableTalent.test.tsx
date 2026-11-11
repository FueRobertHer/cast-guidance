// @vitest-environment jsdom
// Reliable Talent on the Stats tab: a skill check the character is proficient in
// counts a d20 of 9 or lower as a 10 as it lands, and one they are not does not.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  vi.restoreAllMocks();
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

/** The faces the next dice show, in order (the roller draws from crypto). */
function nextFaces(...faces: number[]) {
  const queue = [...faces];
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((buf) => {
    const face = queue.shift();
    if (face === undefined) throw new Error('rolled more dice than the test set up');
    if (buf instanceof Uint32Array) buf[0] = face - 1;
    return buf;
  });
}

const talent: EffectInput = {
  origin: { label: 'Reliable Talent', uid: 'rogue|phb', type: 'class' },
  kind: 'rollReroll',
  on: { rolls: ['check'], proficient: true },
  to: 10,
  auto: true,
  free: true,
};

/** The skill's row tapped twice: the prompt opens, then the same row rolls it. */
function rollSkill(skill: string) {
  const row = screen.getByRole('button', { name: new RegExp(skill) });
  fireEvent.click(row);
  fireEvent.click(row);
  return rollLogStore.getState().rolls[0];
}

describe('Reliable Talent on the Stats tab', () => {
  it('sets a low d20 on a proficient skill check, and leaves the rest as rolled', () => {
    renderStats([talent]);
    nextFaces(4);
    const athletics = rollSkill('Athletics');
    expect(athletics?.total).toBe(14);
    expect(athletics?.meta?.setBy).toEqual(['Reliable Talent']);
    nextFaces(4);
    const history = rollSkill('History');
    expect(history?.total).toBe(4);
    expect(history?.meta?.setBy).toBeUndefined();
  });

  it('leaves a proficient check with no Reliable Talent as rolled', () => {
    renderStats([]);
    nextFaces(4);
    expect(rollSkill('Athletics')?.total).toBe(8);
  });
});
