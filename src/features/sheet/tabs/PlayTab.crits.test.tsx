// @vitest-environment jsdom
// A critical hit through the real sheet: damage rolled for an attack that
// crit rolls its dice twice and its modifiers once. The damage goes with the
// newest attack: its own chips, its riders, a damage action with no save
// (Sneak Attack), and damage tapped while the attack waits in the roll prompt.
import 'fake-indexeddb/auto';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiceRollDetail, RollResult } from '@/dice/types';
import type { ActiveEffect, CharacterDoc, DataEntity } from '@/engine/types';
import { followUpStore, pickHeldTile, rollHeld } from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import {
  castHeld,
  classEntry,
  HARNESS_TIMEOUT,
  left,
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
/** Opens a d20 test's roll prompt, and taps the control again to roll it. */
const rollOn = (el: HTMLElement) => {
  fireEvent.click(el);
  fireEvent.click(el);
};
const damage = (weapon: string, type: string) => screen.getByTitle(`${weapon} ${type} damage`);

describe('a critical hit doubles the damage dice', () => {
  it("rolls the weapon's dice twice on a natural 20, and its modifier once", async () => {
    await renderSheet(fighter());
    nextFaces(20);
    rollOn(attack('Longsword'));
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
    rollOn(attack('Longsword'));
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
    rollOn(attack('Longsword'));
    expect(newest()?.meta?.attack).toMatchObject({ of: 'Longsword', crit: true });
    nextFaces(6, 1);
    fireEvent.click(damage('Longsword', 'slashing'));
    expect(dice(newest())).toEqual(['d8 [6, 1]']);
  });

  it('goes with its own attack: a crit with one weapon leaves the other one alone', async () => {
    await renderSheet(fighter());
    nextFaces(20);
    rollOn(attack('Longsword'));
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
    rollOn(attack('Ember Sword'));
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
    rollOn(attack('Longsword'));
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
    rollOn(screen.getByTitle('Ray Bolt spell attack'));
    nextFaces(9, 8);
    fireEvent.click(screen.getByRole('button', { name: '1d10' }));
    expect(dice(newest())).toEqual(['d10 [9, 8]']);
  });

  it("doubles a spell attack's damage, and never a spell's with no attack roll", async () => {
    await renderSheet(raySorcerer(), { extra: { spell: [ray] } });
    nextFaces(20);
    rollOn(screen.getByTitle('Ray Bolt spell attack'));
    nextFaces(9, 8);
    fireEvent.click(screen.getByRole('button', { name: '1d10' }));
    expect(dice(newest())).toEqual(['d10 [9, 8]']);
    // Searing Bolt has no attack roll: nothing of the crit reaches it. Its
    // chip opens the roll prompt, and tapped again it casts.
    nextFaces(1, 2);
    rollOn(screen.getByRole('button', { name: '2d6' }));
    expect(dice(newest())).toEqual(['d6 [1, 2]']);
  });
});

describe('a spell attack cast at a level', () => {
  /** A spell attack whose damage grows with the slot. */
  const lance: DataEntity = {
    ...ray,
    name: 'Ray Lance',
    entries: ['A lance deals {@damage 1d10} fire damage.'],
    entriesHigherLevel: [
      { entries: ['The damage increases by {@scaledamage 1d10|1-9|1d10} per slot above 1st.'] },
    ],
  };
  const lancer = () => {
    const doc = sorcerer();
    const ref = { name: 'Ray Lance', source: 'TST' };
    doc.spellcasting = { 'sorcerer|tst': { known: [ref], prepared: [ref] } };
    return doc;
  };
  const cast = () => fireEvent.click(screen.getByTitle('Ray Lance spell attack'));

  it('offers the damage at the level picked after a hit, doubled on a crit', async () => {
    await renderSheet(lancer(), { extra: { spell: [lance] } });
    cast();
    nextFaces(20);
    castHeld('Level 3 slot');
    expect(left('Level 3 slot')).toBe(1);
    expect(newest()?.meta?.attack).toMatchObject({ of: 'Ray Lance', crit: true });

    const offer = followUpStore.getState().offer;
    expect(offer?.expr).toBe('6d10');
    nextFaces(1, 2, 3, 4, 5, 6);
    act(() => offer?.go());
    expect(dice(newest())).toEqual(['d10 [1, 2, 3, 4, 5, 6]']);
    // The row's damage chip stays at the level last cast.
    expect(screen.getByTitle('Ray Lance fire damage').textContent).toBe('3d10');
  });

  it('rolls damage tapped while the attack waits at the level picked, doubled on a crit', async () => {
    await renderSheet(lancer(), { extra: { spell: [lance] } });
    cast();
    act(() => pickHeldTile('slot-2'));
    fireEvent.click(screen.getByTitle('Ray Lance fire damage'));
    nextFaces(20, 1, 2, 3, 4);
    act(() => rollHeld());
    expect(dice(newest())).toEqual(['d10 [1, 2, 3, 4]']);
    expect(left('Level 2 slot')).toBe(2);
  });

  it('spends the slot on a miss, and offers nothing after a natural 1', async () => {
    await renderSheet(lancer(), { extra: { spell: [lance] } });
    cast();
    nextFaces(1);
    castHeld();
    expect(left('Level 1 slot')).toBe(3);
    expect(followUpStore.getState().offer).toBeNull();
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
    rollOn(attack('Longsword'));
    expect(newest()?.meta?.attack).toMatchObject({ of: 'Longsword', crit: true });
    nextFaces(5, 6);
    fireEvent.click(damage('Longsword', 'slashing'));
    expect(dice(newest())).toEqual(['d8 [5, 6]']);
    nextFaces(18);
    rollOn(attack('Longsword'));
    expect(newest()?.meta?.attack).toMatchObject({ crit: false });
  });

  it('crits on an 18 with Superior Critical', async () => {
    await renderSheet(champion('Superior Critical'), {
      extra: { feat: [featNamed('Superior Critical')] },
    });
    nextFaces(18);
    rollOn(attack('Shortbow'));
    expect(newest()?.meta?.attack).toMatchObject({ of: 'Shortbow', crit: true });
  });

  it('leaves spell attacks at 20: the range is for weapon attacks', async () => {
    const doc = raySorcerer();
    doc.feats = [{ ref: { name: 'Improved Critical', source: 'TST' }, instanceId: 'f1' }];
    await renderSheet(doc, { extra: { spell: [ray], feat: [featNamed('Improved Critical')] } });
    nextFaces(19);
    rollOn(screen.getByTitle('Ray Bolt spell attack'));
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
    rollOn(attack('Longsword'));
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
    rollOn(attack('Longsword'));
    nextFaces(3);
    fireEvent.click(damage('Longsword', 'slashing'));
    expect(dice(newest())).toEqual(['d8 [3]']);
    nextFaces(20);
    rollOn(attack('Shortbow'));
    nextFaces(2, 4);
    fireEvent.click(damage('Shortbow', 'piercing'));
    expect(dice(newest())).toEqual(['d6 [2, 4]']);
  });
});

describe('damage that waits with its attack', () => {
  it('rolls doubled when the attack it waits on crit, unseen until it lands', async () => {
    await renderSheet(fighter());
    nextFaces(); // nothing rolls until the attack does
    fireEvent.click(attack('Longsword'));
    fireEvent.click(damage('Longsword', 'slashing'));
    expect(rollLogStore.getState().rolls).toHaveLength(0);
    nextFaces(20, 6, 2);
    act(() => rollHeld());
    const [dealt, swing] = rollLogStore.getState().rolls;
    expect(swing?.meta?.attack).toMatchObject({ of: 'Longsword', crit: true });
    expect(dealt?.meta?.withRoll).toBe(swing?.id);
    expect(dice(dealt)).toEqual(['d8 [6, 2]']);
    expect(mods(dealt)).toEqual([3]);
  });

  it('rolls once when the attack it waits on is no crit', async () => {
    await renderSheet(fighter());
    fireEvent.click(attack('Longsword'));
    fireEvent.click(damage('Longsword', 'slashing'));
    nextFaces(11, 6);
    act(() => rollHeld());
    expect(dice(rollLogStore.getState().rolls[0])).toEqual(['d8 [6]']);
  });
});
