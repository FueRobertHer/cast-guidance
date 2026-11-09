// @vitest-environment jsdom
// The roll toast spending a die it offered through the open sheet: adding
// Bardic Inspiration ends it, taking the die off puts it back where it was,
// and a change to hit points stops the dice waiting.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RollResult } from '@/dice/types';
import {
  type ActiveEffect,
  type CharacterDoc,
  type DerivedSheet,
  newCharacterDoc,
} from '@/engine/types';
import { setOneUseDice } from '@/lib/oneUseDice';
import type { DocUpdater } from '@/stores/characterSession';
import { heldRollStore, rollFrom } from '@/stores/heldRoll';
import { rollOffersStore } from '@/stores/rollOffers';
import { useRollOfferSpending } from './rollOfferSpending';

afterEach(() => {
  cleanup();
  act(() => setOneUseDice('after'));
  rollOffersStore.setState({ spend: null, expired: 0, before: false });
});

const fx = (id: string, name: string): ActiveEffect => ({ id, name, parts: [] });
const sheet = {
  maxHp: { value: 20, base: 20, overridden: false, parts: [] },
  conditionImmunities: [],
} as unknown as DerivedSheet;

/** A sheet holding a doc, whose updates apply and re-render, with their labels kept. */
function openSheet(effects: ActiveEffect[], build?: (doc: CharacterDoc) => void) {
  let doc: CharacterDoc = newCharacterDoc('c', 'Hero', 't');
  build?.(doc);
  doc.play.currentHp = 20;
  doc.play.activeEffects = effects;
  const labels: string[] = [];
  const update: DocUpdater = (recipe, label) => {
    const next = structuredClone(doc);
    recipe(next);
    doc = next;
    if (typeof label === 'string') labels.push(label);
    hook.rerender();
  };
  const hook = renderHook(() => useRollOfferSpending(doc, sheet, update));
  return { doc: () => doc, labels, hook, update };
}

const spend = (id: string, taken: boolean) =>
  act(() => rollOffersStore.getState().spend?.(id, taken));

describe('useRollOfferSpending', () => {
  it('ends the effect a die spends, and puts it back in its place when taken off', () => {
    const s = openSheet([fx('a', 'Bless'), fx('b1', 'Bardic Inspiration'), fx('c', 'Haste')]);
    spend('b1', true);
    expect(s.doc().play.activeEffects?.map((e) => e.id)).toEqual(['a', 'c']);
    spend('b1', false);
    expect(s.doc().play.activeEffects?.map((e) => e.id)).toEqual(['a', 'b1', 'c']);
    expect(s.labels).toEqual(['Used Bardic Inspiration', 'Took back Bardic Inspiration']);
    // Nothing spent, nothing to give back.
    spend('b1', false);
    expect(s.labels).toHaveLength(2);
  });

  it('gives back the concentration a spent effect held', () => {
    const guidance = { ...fx('g', 'Guidance'), mine: true, lasts: { concentration: true } };
    const s = openSheet([guidance]);
    act(() => s.update((d) => void (d.play.concentratingOn = { label: 'Guidance' })));
    spend('g', true);
    expect(s.doc().play.concentratingOn).toBeUndefined();
    spend('g', false);
    expect(s.doc().play.concentratingOn).toEqual({ label: 'Guidance' });
  });

  it('lets go of the store when the sheet closes', () => {
    const s = openSheet([]);
    expect(rollOffersStore.getState().spend).not.toBeNull();
    s.hook.unmount();
    expect(rollOffersStore.getState().spend).toBeNull();
  });

  it('stops the dice waiting when hit points change, and only then', () => {
    const s = openSheet([fx('b1', 'Bardic Inspiration')]);
    const seen = rollOffersStore.getState().expired;
    spend('b1', true);
    expect(rollOffersStore.getState().expired).toBe(seen);
    act(() => s.update((d) => void (d.play.currentHp = 12)));
    expect(rollOffersStore.getState().expired).toBe(seen + 1);
    act(() => s.update((d) => void (d.play.tempHp = 5)));
    expect(rollOffersStore.getState().expired).toBe(seen + 2);
  });
});

describe('the house rule for one-use dice', () => {
  const namesFirst = () => rollOffersStore.getState().before;

  it('follows the app choice, unless the character keeps its own', () => {
    const s = openSheet([]);
    expect(namesFirst()).toBe(false);
    act(() => setOneUseDice('before'));
    expect(namesFirst()).toBe(true);
    act(() => s.update((d) => void (d.oneUseDice = 'after')));
    expect(namesFirst()).toBe(false);
    act(() => setOneUseDice('after'));
    act(() => s.update((d) => void (d.oneUseDice = 'before')));
    expect(namesFirst()).toBe(true);
  });

  it('lets a waiting roll go unseen when the sheet closes', () => {
    const s = openSheet([], (d) => void (d.oneUseDice = 'before'));
    const held: RollResult = {
      expr: '1d20',
      label: 'Athletics check',
      total: 12,
      at: 0,
      terms: [],
      meta: {
        askFirst: {
          offers: [{ dice: '1d4', source: 'Guidance', once: true, ifFailed: false }],
          attack: false,
        },
      },
    };
    act(() => rollFrom(null, () => held));
    expect(heldRollStore.getState().held).not.toBeNull();
    s.hook.unmount();
    expect(heldRollStore.getState().held).toBeNull();
    expect(namesFirst()).toBe(false);
  });
});
