// @vitest-environment jsdom
// One-use dice in the roll prompt through the real sheet (the rolls canvas):
// a skill check waits with 2014 Guidance on offer, the die added lands in it
// and ends the spell, the one left comes back after unless the house rule
// drops it, and damage tapped while an attack waits lands with it. The
// prompt's own controls are covered in RollToast.held.
import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bardicEffect, guidanceEffect } from '@/engine/curated/namedEffects';
import type { ActiveEffect } from '@/engine/types';
import { setOneUseDice } from '@/lib/oneUseDice';
import { cancelHeld, heldRollStore, nameHeldDie, rollHeld } from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import {
  classEntry,
  HARNESS_TIMEOUT,
  renderSheet,
  resetSheetHarness,
  testCharacter,
} from '../../../../tests-fixtures/sheetHarness';

vi.mock('@/data5e/loader', () =>
  import('../../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

beforeEach(() => {
  localStorage.clear();
  rollLogStore.getState().clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  act(() => setOneUseDice('after'));
  await resetSheetHarness();
});

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

/** A level-3 warrior under 2014 rules with the effects given in play. */
function warrior(effects: ActiveEffect[]) {
  const doc = testCharacter('Grog', [classEntry('Warrior', 3)], { con: 14 });
  doc.play.currentHp = 20;
  doc.play.hpInitialized = true;
  doc.play.activeEffects = effects;
  return doc;
}

const logged = () => rollLogStore.getState().rolls;
const held = () => heldRollStore.getState().held;

describe('one-use dice in the roll prompt', () => {
  it('offers Guidance in a skill check waiting to roll, then lands it with the die and ends the spell', async () => {
    const sheet = await renderSheet(warrior([guidanceEffect('g1', '2014')]));
    await sheet.tab('Stats');
    nextFaces(); // asking rolls nothing
    fireEvent.click(screen.getByRole('button', { name: /^Roll STR check/ }));
    expect(logged()).toHaveLength(0);
    expect(held()?.ask?.label).toBe('STR check');
    expect(held()?.ask?.once.map((o) => o.source)).toEqual(['Guidance']);

    act(() => nameHeldDie(0));
    nextFaces(12, 3);
    act(() => rollHeld());
    const [roll] = logged();
    expect(roll?.meta?.from).toEqual([{ term: 2, source: 'Guidance' }]);
    expect(roll?.meta?.offers).toBeUndefined();
    await waitFor(async () => expect((await sheet.saved()).play.activeEffects).toBeUndefined());
  });

  it('offers the die left after the roll as written, and drops it under the house rule', async () => {
    const sheet = await renderSheet(warrior([guidanceEffect('g1', '2014')]));
    await sheet.tab('Stats');
    fireEvent.click(screen.getByRole('button', { name: /^Roll STR check/ }));
    nextFaces(12);
    act(() => rollHeld());
    expect(logged()[0]?.meta?.offers?.map((o) => o.source)).toEqual(['Guidance']);

    act(() => setOneUseDice('before'));
    fireEvent.click(screen.getByRole('button', { name: /^Roll STR check/ }));
    nextFaces(9);
    act(() => rollHeld());
    expect(logged()[0]?.meta?.offers).toBeUndefined();
  });

  it('holds an attack, spends the action only once it lands, and rolls the damage tapped meanwhile with it', async () => {
    const doc = warrior([bardicEffect('b1', '2014', 'd8')]);
    doc.oneUseDice = 'before';
    const sheet = await renderSheet(doc);
    nextFaces(); // nothing rolls until the attack does
    fireEvent.click(screen.getByTitle('Unarmed Strike attack'));
    expect(held()?.ask?.attack).toBe(true);
    fireEvent.click(screen.getByTitle(/^Unarmed Strike (\w+ )?damage$/));
    expect(logged()).toHaveLength(0);
    expect(held()?.damage).toHaveLength(1);
    expect((await sheet.saved()).play.turn?.action ?? false).toBe(false);

    nextFaces(14);
    act(() => rollHeld());
    const [dealt, swing] = logged();
    expect(swing?.label).toBe('Unarmed Strike attack');
    expect(dealt?.meta?.withRoll).toBe(swing?.id);
    // Nothing added, under the house rule: Bardic is still there, and not offered after either.
    expect(swing?.meta?.offers).toBeUndefined();
    const saved = await sheet.saved();
    expect(saved.play.activeEffects?.map((e) => e.id)).toEqual(['b1']);
    expect(saved.play.turn?.action).toBe(true);
  });

  it('spends an added die and the action together, as the attack lands', async () => {
    const sheet = await renderSheet(warrior([bardicEffect('b1', '2014', 'd8')]));
    fireEvent.click(screen.getByTitle('Unarmed Strike attack'));
    act(() => nameHeldDie(0));
    nextFaces(14, 6);
    act(() => rollHeld());
    expect(logged()[0]?.meta?.from?.map((f) => f.source)).toEqual(['Bardic Inspiration']);
    const saved = await sheet.saved();
    expect(saved.play.activeEffects).toBeUndefined();
    expect(saved.play.turn?.action).toBe(true);
  });

  it('keeps Ignore once armed through a roll that waits and is cancelled', async () => {
    const doc = warrior([]);
    doc.play.conditions = [{ id: 'Poisoned' }];
    const sheet = await renderSheet(doc);
    await sheet.tab('Stats');
    const ignore = () =>
      screen.getAllByRole('button', {
        name: 'Ignore once: your next ability check without these effects',
      })[0];
    fireEvent.click(ignore() as HTMLElement);
    expect(ignore()?.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /^Roll STR check/ }));
    expect(held()).not.toBeNull();
    act(() => cancelHeld());
    expect(ignore()?.getAttribute('aria-pressed')).toBe('true');

    // Landing spends it, and the roll was made without the effects.
    fireEvent.click(screen.getByRole('button', { name: /^Roll STR check/ }));
    nextFaces(12);
    act(() => rollHeld());
    expect(logged()[0]?.meta?.cue).toBe('Conditions ignored for this roll');
    expect(ignore()?.getAttribute('aria-pressed')).toBe('false');
  });
});
