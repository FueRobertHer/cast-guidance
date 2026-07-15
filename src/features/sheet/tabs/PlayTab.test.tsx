// @vitest-environment jsdom
// FIX-003: the HP damage/heal controls apply an exact, deterministic amount and
// roll exactly one concentration save per gesture. (The old single/double-tap
// combo double-fired: a "double-tap −5" applied −6 and rolled up to three saves.)
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { rollLogStore } from '@/stores/rollLog';
import { makeTestContext } from '../../../../tests-fixtures/testWorld';
import type { CharacterSheetState } from '../useCharacterSheet';
import { Component as PlayTab } from './PlayTab';

afterEach(() => {
  cleanup();
  rollLogStore.getState().clear();
});

/** Render the Play tab for a level-3 Warrior at full HP; returns a live doc getter. */
function renderPlay(mutate?: (doc: CharacterDoc) => void) {
  const doc = newCharacterDoc('p1', 'Hero', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
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
  return { start: sheet.maxHp.value, getDoc: () => current };
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
