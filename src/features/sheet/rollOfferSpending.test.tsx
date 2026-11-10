// @vitest-environment jsdom
// The roll toast spending a die it offered through the open sheet: adding
// Bardic Inspiration ends it, taking the die off puts it back where it was,
// and a change to hit points stops the dice waiting. The open character's
// table rules reach the dice through its derived sheet.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { roll } from '@/dice/roll';
import { sheetRulesField } from '@/engine/rules';
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
import { setAppTableRule, useAppTableRules } from '@/stores/tableRules';
import { d20Ask } from './d20Tests';
import { useRollOfferSpending } from './rollOfferSpending';

afterEach(() => {
  cleanup();
  act(() => setOneUseDice('after'));
  act(() => setAppTableRule('critDamage', undefined));
  rollOffersStore.setState({ spend: null, expired: 0, before: false });
});

const fx = (id: string, name: string): ActiveEffect => ({ id, name, parts: [] });
const sheet = {
  maxHp: { value: 20, base: 20, overridden: false, parts: [] },
  conditionImmunities: [],
} as unknown as DerivedSheet;

/**
 * A sheet holding a doc, whose updates apply and re-render, with their labels
 * kept. Its sheet carries the rules derive would give it, again when the app's
 * change, as the sheet re-derives then.
 */
function openSheet(effects: ActiveEffect[], build?: (doc: CharacterDoc) => void) {
  let doc: CharacterDoc = newCharacterDoc('c', 'Hero', 't');
  build?.(doc);
  doc.play.currentHp = 20;
  doc.play.activeEffects = effects;
  const labels: string[] = [];
  let derived = true;
  const update: DocUpdater = (recipe, label) => {
    const next = structuredClone(doc);
    recipe(next);
    doc = next;
    if (typeof label === 'string') labels.push(label);
    hook.rerender();
  };
  const hook = renderHook(() => {
    const app = useAppTableRules();
    const { rules } = sheetRulesField(doc, { byType: () => [], rules: app });
    const shown = rules === undefined ? sheet : { ...sheet, rules };
    return useRollOfferSpending(doc, derived ? shown : null, update);
  });
  /** The sheet gone while it re-derives (`false`), or back (`true`). */
  const derive = (on: boolean) => {
    derived = on;
    hook.rerender();
  };
  return { doc: () => doc, labels, hook, update, derive };
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
  /** An Athletics check that offers Guidance's die. */
  const guidanceAsk = () =>
    d20Ask('1d20', {
      label: 'Athletics check',
      riders: {
        dice: [],
        offers: [{ dice: '1d4', source: 'Guidance', once: true, ifFailed: false }],
        advantage: [],
        disadvantage: [],
      },
    });

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

  it('keeps a waiting roll while the sheet re-derives', () => {
    const s = openSheet([], (d) => void (d.oneUseDice = 'before'));
    act(() => rollFrom(null, () => guidanceAsk()));
    expect(heldRollStore.getState().held).not.toBeNull();
    act(() => s.derive(false));
    expect(namesFirst()).toBe(true);
    act(() => s.derive(true));
    expect(heldRollStore.getState().held).not.toBeNull();
    expect(namesFirst()).toBe(true);
  });

  it('lets a waiting roll go unseen when the sheet closes', () => {
    const s = openSheet([], (d) => void (d.oneUseDice = 'before'));
    act(() => rollFrom(null, () => guidanceAsk()));
    expect(heldRollStore.getState().held).not.toBeNull();
    s.hook.unmount();
    expect(heldRollStore.getState().held).toBeNull();
    expect(namesFirst()).toBe(false);
  });
});

describe("the open character's critical hits", () => {
  // A 1d6 + 1 crit with the d6 showing 2, and 3 when rolled again.
  const crit = () => {
    const faces = [2, 3];
    return roll('1d6+1', { critical: true, rng: () => faces.shift() ?? 1 }).total;
  };

  it('count by the character’s rule while the sheet is open, and as written once it closes', () => {
    const s = openSheet([], (d) => void (d.tableRules = { critDamage: 'maxPlusRoll' }));
    expect(crit()).toBe(6 + 2 + 1);
    act(() => s.update((d) => void (d.tableRules = { critDamage: 'doubleTotal' })));
    expect(crit()).toBe((2 + 1) * 2);
    s.hook.unmount();
    expect(crit()).toBe(2 + 3 + 1);
  });

  it('follow the app’s rule when the character has none', () => {
    openSheet([]);
    expect(crit()).toBe(2 + 3 + 1);
    act(() => setAppTableRule('critDamage', 'maxPlusRoll'));
    expect(crit()).toBe(6 + 2 + 1);
  });
});
