// @vitest-environment jsdom
// FIX-003: the HP damage/heal controls apply an exact, deterministic amount and
// roll exactly one concentration save per gesture. (The old single/double-tap
// combo double-fired: a "double-tap −5" applied −6 and rolled up to three saves.)
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { rollLogStore } from '@/stores/rollLog';
import { makeTestContext } from '../../../../tests-fixtures/testWorld';
import type { CharacterSheetState } from '../useCharacterSheet';
import { Component as PlayTab } from './PlayTab';

// The sheet reads spell text through the registry: without one, every granted
// spell renders as a bare Cast button, which is the one path a limited grant
// usually does NOT take. The synthetic world stands in for the compendium.
vi.mock('@/data5e/hooks', () => ({ useRegistry: () => makeTestContext() }));

afterEach(() => {
  cleanup();
  rollLogStore.getState().clear();
});

/** Render the Play tab for a level-3 Warrior at full HP; returns a live doc getter. */
function renderPlay(mutate?: (doc: CharacterDoc) => void, build?: (doc: CharacterDoc) => void) {
  const doc = newCharacterDoc('p1', 'Hero', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
  // "build" changes what the sheet is derived FROM (equipment, classes);
  // "mutate" changes play state afterwards, which derivation does not read.
  build?.(doc);
  const sheet = deriveSheet(doc, makeTestContext());
  doc.play.currentHp = sheet.maxHp.value;
  doc.play.hpInitialized = true;
  mutate?.(doc);

  let current = doc;
  const update = (recipe: (d: CharacterDoc) => void) => {
    const d = structuredClone(current);
    recipe(d);
    current = d;
  };
  const ctxValue = {
    doc,
    sheet,
    update,
    loadStatus: 'ready',
    missing: false,
    error: null,
    saveStatus: 'saved',
    retryLoad: () => undefined,
  } as unknown as CharacterSheetState;

  const router = createMemoryRouter([
    {
      path: '/',
      element: <Outlet context={ctxValue} />,
      children: [{ index: true, element: <PlayTab /> }],
    },
  ]);
  render(<RouterProvider router={router} />);
  return { start: sheet.maxHp.value, sheet, getDoc: () => current };
}

describe('PlayTab HP controls (FIX-003)', () => {
  it('applies an exact amount per click (−5 is −5, not −6)', () => {
    const { start, getDoc } = renderPlay();
    fireEvent.click(screen.getByLabelText('Damage 5 hit points'));
    expect(getDoc().play.currentHp).toBe(start - 5);
    fireEvent.click(screen.getByLabelText('Damage 1 hit point'));
    expect(getDoc().play.currentHp).toBe(start - 6);
    fireEvent.click(screen.getByLabelText('Heal 5 hit points'));
    expect(getDoc().play.currentHp).toBe(start - 1);
  });

  it('rolls exactly one concentration save for a single damage gesture', () => {
    const { getDoc } = renderPlay((d) => {
      d.play.concentratingOn = { label: 'Bless' };
    });
    rollLogStore.getState().clear();
    fireEvent.click(screen.getByLabelText('Damage 5 hit points'));
    const { rolls } = rollLogStore.getState();
    const conc = rolls.filter((r) => /Concentration save/.test(r.label ?? ''));
    expect(conc).toHaveLength(1);
    // Concentration is still held (nothing dropped it to 0) unless the save failed.
    expect(getDoc().play.currentHp).toBeGreaterThan(0);
  });
});

/** A wand granting searing bolt once a day, equipped. */
const withWand = (doc: CharacterDoc) => {
  doc.equipment = [
    {
      id: 'w1',
      ref: { name: 'Wand of Searing', source: 'TST' },
      qty: 1,
      equipped: true,
      attuned: false,
    },
  ];
};

describe('PlayTab limited granted spells', () => {
  it('spends a use when the spell is cast from its roll chip', () => {
    const { sheet, getDoc } = renderPlay(undefined, withWand);
    const grant = sheet.grantedSpells.find((g) => g.name === 'searing bolt');
    expect(grant?.usage).toBe('1/day');
    expect(screen.getByText('1/1 per day')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '2d6' }));

    const key = grant?.resourceKey ?? '';
    expect(getDoc().play.resources).toContainEqual({ key, used: 1 });
    // Casting also marks the action it took, as any other cast does.
    expect(getDoc().play.turn?.action).toBe(true);
  });

  it('will not cast a grant with no uses left, from the chip or anywhere else', () => {
    // Most limited spells have dice and so cast from a chip rather than the
    // Cast button; a guard on the button alone would leave the limit unenforced.
    const { sheet, getDoc } = renderPlay((doc) => {
      const key = sheet_key(doc);
      doc.play.resources = [{ key, used: 1 }];
    }, withWand);
    expect(screen.getByText('0/1 per day')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '2d6' }));

    // The dice still rolled (rolling is always allowed), but nothing was spent
    // and no part of the turn was consumed.
    expect(rollLogStore.getState().rolls.length).toBeGreaterThan(0);
    expect(getDoc().play.resources).toEqual([{ key: sheet_key(getDoc()), used: 1 }]);
    expect(getDoc().play.turn?.action).not.toBe(true);
    expect(sheet.grantedSpells).toHaveLength(1);
  });
});

/** The resource key the engine gives the wand's grant, read from a derived sheet. */
function sheet_key(doc: CharacterDoc): string {
  const derived = deriveSheet(doc, makeTestContext());
  return derived.grantedSpells.find((g) => g.name === 'searing bolt')?.resourceKey ?? '';
}
