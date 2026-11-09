// @vitest-environment jsdom
// A critical hit through the real sheet: damage rolled for an attack that
// crit rolls its dice twice and its modifiers once. The damage goes with the
// newest attack: its own chips, its riders, a damage action with no save
// (Sneak Attack), and damage tapped while the attack waits for a one-use die.
import 'fake-indexeddb/auto';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiceRollDetail, RollResult } from '@/dice/types';
import { bardicEffect } from '@/engine/curated/namedEffects';
import type { ActiveEffect, CharacterDoc, DataEntity } from '@/engine/types';
import { setOneUseDice } from '@/lib/oneUseDice';
import { rollHeld } from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import {
  classEntry,
  HARNESS_TIMEOUT,
  renderSheet,
  resetSheetHarness,
  sorcerer,
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

const newest = (): RollResult | undefined => rollLogStore.getState().rolls[0];
/** A roll's die groups as "2d8 [3, 5]" faces, and its flat modifiers. */
const dice = (r: RollResult | undefined) =>
  (r?.terms ?? [])
    .filter((t): t is DiceRollDetail => t.kind === 'dice')
    .map((t) => `d${String(t.sides)} [${t.rolls.map((x) => x.v).join(', ')}]`);
const mods = (r: RollResult | undefined) =>
  (r?.terms ?? []).flatMap((t) => (t.kind === 'mod' ? [t.value] : []));

/** A level-3 warrior with STR 16 (+3), a longsword and a shortbow in hand. */
function fighter(more: (doc: CharacterDoc) => void = () => {}) {
  const doc = testCharacter('Grog', [classEntry('Warrior', 3)], { str: 16, con: 14 });
  doc.play.currentHp = 20;
  doc.play.hpInitialized = true;
  doc.equipment = [
    {
      id: 'e1',
      ref: { name: 'Longsword', source: 'TST' },
      qty: 1,
      equipped: true,
      attuned: false,
    },
    { id: 'e2', ref: { name: 'Shortbow', source: 'TST' }, qty: 1, equipped: true, attuned: false },
  ];
  more(doc);
  return doc;
}

const ray: DataEntity = {
  name: 'Ray Bolt',
  source: 'TST',
  level: 1,
  school: 'V',
  time: [{ number: 1, unit: 'action' }],
  spellAttack: ['R'],
  entries: ['A ray deals {@damage 1d10} fire damage.'],
};
/** A sorcerer who knows Ray Bolt (an attack roll) and Searing Bolt (none). */
const raySorcerer = () => {
  const doc = sorcerer();
  const bolt = { name: 'Searing Bolt', source: 'TST' };
  const rayRef = { name: 'Ray Bolt', source: 'TST' };
  doc.spellcasting = { 'sorcerer|tst': { known: [bolt, rayRef], prepared: [bolt, rayRef] } };
  return doc;
};

const attack = (weapon: string) => screen.getByTitle(`${weapon} attack`);
const damage = (weapon: string, type: string) => screen.getByTitle(`${weapon} ${type} damage`);

describe('a critical hit doubles the damage dice', () => {
  it("rolls the weapon's dice twice on a natural 20, and its modifier once", async () => {
    await renderSheet(fighter());
    nextFaces(20);
    fireEvent.click(attack('Longsword'));
    nextFaces(3, 5);
    fireEvent.click(damage('Longsword', 'slashing'));
    const dealt = newest();
    expect(dice(dealt)).toEqual(['d8 [3, 5]']);
    expect(mods(dealt)).toEqual([3]);
    expect(dealt?.total).toBe(11);
    expect(dealt?.meta?.critical).toBe(true);
    // Two-handed is the same attack's damage: it crits too.
    nextFaces(7, 2);
    fireEvent.click(screen.getByTitle('Longsword slashing damage (two-handed)'));
    expect(dice(newest())).toEqual(['d10 [7, 2]']);
  });

  it('rolls them once on a hit that is no crit', async () => {
    await renderSheet(fighter());
    nextFaces(19);
    fireEvent.click(attack('Longsword'));
    nextFaces(4);
    fireEvent.click(damage('Longsword', 'slashing'));
    expect(dice(newest())).toEqual(['d8 [4]']);
    expect(newest()?.meta?.critical).toBeUndefined();
  });

  it("crits inside the character's range, which an effect in play lowers", async () => {
    const curse: ActiveEffect = {
      id: 'hc1',
      name: "Hexblade's Curse",
      parts: [{ kind: 'critRange', min: 19 }],
    };
    await renderSheet(fighter((d) => (d.play.activeEffects = [curse])));
    nextFaces(19);
    fireEvent.click(attack('Longsword'));
    expect(newest()?.meta?.attack).toMatchObject({ of: 'Longsword', crit: true });
    nextFaces(6, 1);
    fireEvent.click(damage('Longsword', 'slashing'));
    expect(dice(newest())).toEqual(['d8 [6, 1]']);
  });

  it('goes with its own attack: a crit with one weapon leaves the other one alone', async () => {
    await renderSheet(fighter());
    nextFaces(20);
    fireEvent.click(attack('Longsword'));
    nextFaces(4);
    fireEvent.click(damage('Shortbow', 'piercing'));
    expect(dice(newest())).toEqual(['d6 [4]']);
  });

  it("doubles a weapon rider's dice with the weapon's", async () => {
    const ember: DataEntity = {
      name: 'Ember Sword',
      source: 'TST',
      type: 'M',
      weaponCategory: 'martial',
      weapon: true,
      dmg1: '1d8',
      dmgType: 'S',
      extraDamage: { dmg: '1d6', dmgType: 'F' },
    };
    const doc = fighter((d) => {
      d.equipment = [
        {
          id: 'e3',
          ref: { name: 'Ember Sword', source: 'TST' },
          qty: 1,
          equipped: true,
          attuned: false,
        },
      ];
    });
    await renderSheet(doc, { extra: { baseitem: [ember] } });
    nextFaces(20);
    fireEvent.click(attack('Ember Sword'));
    nextFaces(2, 6);
    fireEvent.click(damage('Ember Sword', 'fire'));
    expect(dice(newest())).toEqual(['d6 [2, 6]']);
  });

  it('doubles a damage action with no save (Sneak Attack), and never one the target saves against', async () => {
    const origin = { label: 'Test', uid: 'feat|test', type: 'feat' } as const;
    const doc = fighter((d) => {
      d.customEffects = [
        { origin, kind: 'action', economy: 'none', label: 'Sneaky Strike', roll: '2d6' },
        {
          origin,
          kind: 'action',
          economy: 'action',
          label: 'Fire Breath',
          roll: '3d6',
          save: { targetAbility: 'dex', dcAbility: 'con' },
        },
      ];
    });
    await renderSheet(doc);
    nextFaces(20);
    fireEvent.click(attack('Longsword'));
    nextFaces(1, 2, 3, 4);
    fireEvent.click(screen.getByRole('button', { name: '2d6' }));
    expect(dice(newest())).toEqual(['d6 [1, 2, 3, 4]']);
    nextFaces(1, 2, 3);
    fireEvent.click(screen.getByRole('button', { name: '3d6' }));
    expect(dice(newest())).toEqual(['d6 [1, 2, 3]']);
  });

  it("doubles a spell attack's damage on the Spells tab too", async () => {
    const sheet = await renderSheet(raySorcerer(), { extra: { spell: [ray] } });
    await sheet.tab('Spells');
    nextFaces(20);
    fireEvent.click(screen.getByTitle('Ray Bolt spell attack'));
    nextFaces(9, 8);
    fireEvent.click(screen.getByRole('button', { name: '1d10' }));
    expect(dice(newest())).toEqual(['d10 [9, 8]']);
  });

  it("doubles a spell attack's damage, and never a spell's with no attack roll", async () => {
    await renderSheet(raySorcerer(), { extra: { spell: [ray] } });
    nextFaces(20);
    fireEvent.click(screen.getByTitle('Ray Bolt spell attack'));
    nextFaces(9, 8);
    fireEvent.click(screen.getByRole('button', { name: '1d10' }));
    expect(dice(newest())).toEqual(['d10 [9, 8]']);
    // Searing Bolt has no attack roll: nothing of the crit reaches it.
    nextFaces(1, 2);
    fireEvent.click(screen.getByRole('button', { name: '2d6' }));
    expect(dice(newest())).toEqual(['d6 [1, 2]']);
  });
});

describe('Improved Critical and Superior Critical', () => {
  /** A feat that carries the Champion's feature by name, as a class's card would. */
  const featNamed = (name: string): DataEntity => ({
    name,
    source: 'TST',
    entries: ['Your weapon attacks score a critical hit on a lower roll.'],
  });
  const champion = (name: string) =>
    fighter((d) => {
      d.feats = [{ ref: { name, source: 'TST' }, instanceId: 'f1' }];
    });

  it('crits a weapon attack on a 19 with Improved Critical, and its damage doubles', async () => {
    await renderSheet(champion('Improved Critical'), {
      extra: { feat: [featNamed('Improved Critical')] },
    });
    nextFaces(19);
    fireEvent.click(attack('Longsword'));
    expect(newest()?.meta?.attack).toMatchObject({ of: 'Longsword', crit: true });
    nextFaces(5, 6);
    fireEvent.click(damage('Longsword', 'slashing'));
    expect(dice(newest())).toEqual(['d8 [5, 6]']);
    nextFaces(18);
    fireEvent.click(attack('Longsword'));
    expect(newest()?.meta?.attack).toMatchObject({ crit: false });
  });

  it('crits on an 18 with Superior Critical', async () => {
    await renderSheet(champion('Superior Critical'), {
      extra: { feat: [featNamed('Superior Critical')] },
    });
    nextFaces(18);
    fireEvent.click(attack('Shortbow'));
    expect(newest()?.meta?.attack).toMatchObject({ of: 'Shortbow', crit: true });
  });

  it('leaves spell attacks at 20: the range is for weapon attacks', async () => {
    const doc = raySorcerer();
    doc.feats = [{ ref: { name: 'Improved Critical', source: 'TST' }, instanceId: 'f1' }];
    await renderSheet(doc, { extra: { spell: [ray], feat: [featNamed('Improved Critical')] } });
    nextFaces(19);
    fireEvent.click(screen.getByTitle('Ray Bolt spell attack'));
    expect(newest()?.meta?.attack).toMatchObject({ of: 'Ray Bolt', crit: false });
  });
});

describe('Savage Attacks', () => {
  /** A race whose trait sits inside its card, as real races carry theirs. */
  const tuskfolk: DataEntity = {
    name: 'Tuskfolk',
    source: 'TST',
    speed: 30,
    entries: [
      {
        name: 'Savage Attacks',
        type: 'entries',
        entries: ['On a melee critical hit, roll one weapon damage die again and add it.'],
      },
    ],
  };
  const savage = () =>
    fighter((d) => {
      d.race = { name: 'Tuskfolk', source: 'TST' };
    });

  it('adds one more weapon die on a melee crit, named for it', async () => {
    await renderSheet(savage(), { extra: { race: [tuskfolk] } });
    nextFaces(20);
    fireEvent.click(attack('Longsword'));
    nextFaces(3, 5, 8);
    fireEvent.click(damage('Longsword', 'slashing'));
    const dealt = newest();
    expect(dice(dealt)).toEqual(['d8 [3, 5]', 'd8 [8]']);
    expect(mods(dealt)).toEqual([3]);
    expect(dealt?.total).toBe(19);
    expect(dealt?.meta?.from).toEqual([{ term: 2, source: 'Savage Attacks' }]);
  });

  it('adds nothing on a hit that is no crit, nor on a ranged crit', async () => {
    await renderSheet(savage(), { extra: { race: [tuskfolk] } });
    nextFaces(12);
    fireEvent.click(attack('Longsword'));
    nextFaces(3);
    fireEvent.click(damage('Longsword', 'slashing'));
    expect(dice(newest())).toEqual(['d8 [3]']);
    nextFaces(20);
    fireEvent.click(attack('Shortbow'));
    nextFaces(2, 4);
    fireEvent.click(damage('Shortbow', 'piercing'));
    expect(dice(newest())).toEqual(['d6 [2, 4]']);
  });
});

describe('damage that waits with its attack', () => {
  it('rolls doubled when the attack it waits on crit, unseen until it lands', async () => {
    const doc = fighter((d) => {
      d.play.activeEffects = [bardicEffect('b1', '2014', 'd8')];
      d.oneUseDice = 'before';
    });
    await renderSheet(doc);
    nextFaces(20);
    fireEvent.click(attack('Longsword'));
    nextFaces(6, 2);
    fireEvent.click(damage('Longsword', 'slashing'));
    expect(rollLogStore.getState().rolls).toHaveLength(0);
    act(() => rollHeld());
    const [dealt, swing] = rollLogStore.getState().rolls;
    expect(swing?.meta?.attack).toMatchObject({ of: 'Longsword', crit: true });
    expect(dealt?.meta?.withRoll).toBe(swing?.id);
    expect(dice(dealt)).toEqual(['d8 [6, 2]']);
    expect(mods(dealt)).toEqual([3]);
  });

  it('rolls once when the attack it waits on is no crit', async () => {
    const doc = fighter((d) => {
      d.play.activeEffects = [bardicEffect('b1', '2014', 'd8')];
      d.oneUseDice = 'before';
    });
    await renderSheet(doc);
    nextFaces(11);
    fireEvent.click(attack('Longsword'));
    nextFaces(6);
    fireEvent.click(damage('Longsword', 'slashing'));
    act(() => rollHeld());
    expect(dice(rollLogStore.getState().rolls[0])).toEqual(['d8 [6]']);
  });
});
