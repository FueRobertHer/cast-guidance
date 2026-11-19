// @vitest-environment jsdom
// What the damage prompt adds to a weapon's hit, through the real sheet and
// the roll toast: a smite cast as the hit lands (its slot tiles, paid as Roll
// lands its dice at the level picked), the more it deals to a Fiend or an
// Undead, a spell concentrated on (Hex on every hit, a 2014 smite on the next
// one alone), 2014 Great Weapon Master's -5 to hit for +10 damage, Savage
// Attacker once a turn, and Action Surge's second Attack action.
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiceRollDetail, RollResult } from '@/dice/types';
import type { CharacterDoc, DataEntity } from '@/engine/types';
import { heldRollStore } from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import { RollToast } from '@/ui/RollToast';
import {
  castTiles,
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

const rolls = () => rollLogStore.getState().rolls;
/** A roll's die groups as "d8 [3, 5]" faces. */
const dice = (r: RollResult | undefined) =>
  (r?.terms ?? [])
    .filter((t): t is DiceRollDetail => t.kind === 'dice')
    .map((t) => `d${String(t.sides)} [${t.rolls.map((x) => x.v).join(', ')}]`);

const attack = (weapon: string) => screen.getByTitle(`${weapon} attack`);
/** Opens a d20 test's roll prompt, and taps the control again to roll it. */
const rollOn = (el: HTMLElement) => {
  fireEvent.click(el);
  fireEvent.click(el);
};
/** The damage prompt open for `label`. */
const prompt = (label: string) => screen.getByRole('group', { name: `${label}, choose and roll` });
/** Opens a weapon's damage prompt from its chip. */
const openDamage = (weapon: string, type: string) => {
  fireEvent.click(screen.getByTitle(`${weapon} ${type} damage`));
  return prompt(`${weapon} ${type} damage`);
};
/** Presses a button inside `el` by its name. */
const press = (el: HTMLElement, name: string | RegExp) =>
  fireEvent.click(within(el).getByRole('button', { name }));
/** One extra's toggle in the damage prompt, by its name. */
const extra = (el: HTMLElement, name: RegExp) => within(el).getByRole('button', { name });
const noExtra = (el: HTMLElement, name: RegExp) =>
  expect(within(el).queryByRole('button', { name })).toBeNull();
const pressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';

const LONGSWORD = { name: 'Longsword', source: 'TST' };
const SHORTBOW = { name: 'Shortbow', source: 'TST' };
const carried = (...refs: Array<{ name: string; source: string }>): CharacterDoc['equipment'] =>
  refs.map((ref, i) => ({
    id: `e${String(i + 1)}`,
    ref,
    qty: 1,
    equipped: true,
    attuned: false,
  }));

/** The harness's level-5 sorcerer (slots 4, 3, 2), knowing `spells`, a longsword and a shortbow in hand. */
function caster(...spells: string[]) {
  const doc = sorcerer();
  const refs = spells.map((name) => ({ name, source: 'TST' }));
  doc.spellcasting = { 'sorcerer|tst': { known: refs, prepared: refs } };
  doc.equipment = carried(LONGSWORD, SHORTBOW);
  return doc;
}

/** A warrior with STR 16 (+3), level 3 unless said, and what `more` sets. */
function fighter(more: (doc: CharacterDoc) => void = () => {}, level = 3) {
  const doc = testCharacter('Grog', [classEntry('Warrior', level)], { str: 16, con: 14 });
  doc.play.currentHp = 20;
  doc.play.hpInitialized = true;
  doc.equipment = carried(LONGSWORD);
  more(doc);
  return doc;
}

/** A 2024 smite: cast as a bonus action once a melee hit lands. */
const ON_A_MELEE_HIT = {
  number: 1,
  unit: 'bonus',
  condition:
    'which you take immediately after hitting a target with a Melee weapon or an Unarmed Strike',
};
const searingStrike: DataEntity = {
  name: 'Searing Strike',
  source: 'TST',
  level: 1,
  school: 'V',
  time: [ON_A_MELEE_HIT],
  range: { type: 'point', distance: { type: 'self' } },
  entries: ['As you hit the target, it takes an extra {@damage 1d6} Fire damage from the attack.'],
  entriesHigherLevel: [
    {
      type: 'entries',
      name: 'Using a Higher-Level Spell Slot',
      entries: ['The damage increases by {@scaledamage 1d6|1-9|1d6} for each slot level above 1.'],
    },
  ],
};

describe('a smite cast as the hit lands', () => {
  it('is offered off on a melee weapon, and its tiles pick the level Roll casts it at', async () => {
    const sheet = await renderSheet(caster('Searing Strike'), {
      extra: { spell: [searingStrike] },
    });
    render(<RollToast />);
    nextFaces(); // asking rolls nothing
    // A ranged weapon's hit is not the smite's.
    noExtra(openDamage('Shortbow', 'piercing'), /Searing Strike/);
    const group = openDamage('Longsword', 'slashing');
    const smite = extra(group, /^Searing Strike, spell/);
    expect(pressed(smite)).toBe(false);
    expect(castTiles()).toEqual([]);

    fireEvent.click(smite);
    expect(castTiles().slice(0, 3)).toEqual([
      'Level 1 slot, 4 left',
      'Level 2 slot, 3 left',
      'Level 3 slot, 2 left',
    ]);
    expect(pressed(extra(group, /^\+d6 fire Searing Strike, spell/))).toBe(true);
    press(group, 'Level 2 slot, 3 left');
    expect(pressed(extra(group, /^\+2d6 fire Searing Strike, spell/))).toBe(true);

    nextFaces(4, 2, 5);
    press(group, 'Roll');
    const [fire, slashing] = rolls();
    expect(slashing?.label).toBe('Longsword slashing damage');
    expect(dice(slashing)).toEqual(['d8 [4]']);
    expect(fire?.label).toBe('Searing Strike fire damage');
    expect(fire?.meta?.withRoll).toBe(slashing?.id);
    expect(dice(fire)).toEqual(['d6 [2, 5]']);
    expect(left('Level 2 slot')).toBe(2);
    const saved = await sheet.saved();
    expect(saved.play.turn?.bonus).toBe(true);
    expect(saved.play.turn?.action ?? false).toBe(false);
  });

  it('rolls its dice twice on a crit', async () => {
    await renderSheet(caster('Searing Strike'), { extra: { spell: [searingStrike] } });
    render(<RollToast />);
    nextFaces(20);
    rollOn(attack('Longsword'));
    nextFaces();
    const group = openDamage('Longsword', 'slashing');
    fireEvent.click(extra(group, /^Searing Strike, spell/));
    // The tile it starts on is the lowest slot: 1d6, doubled.
    expect(pressed(extra(group, /^\+2d6 fire Searing Strike, spell/))).toBe(true);
    nextFaces(1, 2, 3, 4);
    press(group, 'Roll');
    const [fire, slashing] = rolls();
    expect(dice(slashing)).toEqual(['d8 [1, 2]']);
    expect(dice(fire)).toEqual(['d6 [3, 4]']);
    expect(fire?.meta?.critical).toBe(true);
    expect(left('Level 1 slot')).toBe(3);
  });
});

describe('a smite that deals more to a Fiend or an Undead', () => {
  const radiantSmite: DataEntity = {
    name: 'Radiant Smite',
    source: 'TST',
    level: 1,
    school: 'V',
    time: [ON_A_MELEE_HIT],
    range: { type: 'point', distance: { type: 'self' } },
    entries: [
      'The target takes an extra {@damage 2d8} radiant damage from the attack. The damage increases by {@damage 1d8} if the target is a Fiend or an Undead.',
    ],
    entriesHigherLevel: [
      { entries: ['The damage increases by {@scaledamage 2d8|1-5|1d8} for each slot above 1.'] },
    ],
  };
  const against = /Radiant Smite vs a Fiend or Undead, if it is one/;

  it('offers the more only while the smite is on, and rolls it with the smite', async () => {
    await renderSheet(caster('Radiant Smite'), { extra: { spell: [radiantSmite] } });
    render(<RollToast />);
    nextFaces();
    let group = openDamage('Longsword', 'slashing');
    noExtra(group, against);
    fireEvent.click(extra(group, /^Radiant Smite, spell/));
    const more = extra(group, against);
    expect(more.getAttribute('aria-label')).toMatch(/^\+d8 radiant Radiant Smite vs/);
    expect(pressed(more)).toBe(false);
    fireEvent.click(more);

    nextFaces(5, 1, 2, 7);
    press(group, 'Roll');
    const [fiend, smite, slashing] = rolls();
    expect(slashing?.label).toBe('Longsword slashing damage');
    expect(smite?.label).toBe('Radiant Smite radiant damage');
    expect(dice(smite)).toEqual(['d8 [1, 2]']);
    expect(fiend?.label).toBe('Radiant Smite damage vs a Fiend or Undead');
    expect(fiend?.meta?.withRoll).toBe(slashing?.id);
    expect(dice(fiend)).toEqual(['d8 [7]']);
    expect(left('Level 1 slot')).toBe(3);

    // Put on, then the smite taken off: the more goes with it, and neither rolls.
    group = openDamage('Longsword', 'slashing');
    fireEvent.click(extra(group, /^Radiant Smite, spell/));
    fireEvent.click(extra(group, against));
    fireEvent.click(extra(group, /Radiant Smite, spell/));
    noExtra(group, against);
    nextFaces(6);
    press(group, 'Roll');
    expect(rolls()).toHaveLength(4);
    expect(rolls()[0]?.label).toBe('Longsword slashing damage');
    expect(left('Level 1 slot')).toBe(3);
  });
});

describe('a spell the character concentrates on', () => {
  /** Hex's shape: extra dice on the target the spell marked, every hit. */
  const witchMark: DataEntity = {
    name: 'Witch Mark',
    source: 'TST',
    level: 1,
    school: 'E',
    time: [{ number: 1, unit: 'bonus' }],
    range: { type: 'point', distance: { type: 'feet', amount: 90 } },
    duration: [{ type: 'timed', duration: { type: 'hour', amount: 1 }, concentration: true }],
    entries: [
      'You place a curse on a creature that you can see within range. Until the spell ends, you deal an extra {@damage 1d6} necrotic damage to the target whenever you hit it with an attack.',
    ],
  };
  /** A 2014 smite's shape: cast first, extra dice on the next melee hit alone. */
  const burningSmite: DataEntity = {
    name: 'Burning Smite',
    source: 'TST',
    level: 1,
    school: 'V',
    time: [{ number: 1, unit: 'bonus' }],
    range: { type: 'point', distance: { type: 'self' } },
    duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
    entries: [
      "The next time you hit a creature with a melee weapon attack during the spell's duration, your weapon flares, and the attack deals an extra {@damage 1d6} fire damage to the target.",
    ],
    entriesHigherLevel: [
      {
        type: 'entries',
        name: 'At Higher Levels',
        entries: [
          'The extra damage increases by {@scaledamage 1d6|1-9|1d6} for each slot level above 1st.',
        ],
      },
    ],
  };

  it('rolls a spell on its marked target on every hit, apart, from the start', async () => {
    const doc = caster('Witch Mark');
    doc.play.concentratingOn = { label: 'Witch Mark', level: 1 };
    await renderSheet(doc, { extra: { spell: [witchMark] } });
    render(<RollToast />);
    nextFaces();
    const group = openDamage('Longsword', 'slashing');
    const mark = extra(group, /^\+d6 necrotic Witch Mark, concentrating/);
    expect(pressed(mark)).toBe(true);
    expect(group.textContent).toContain("Witch Mark: Only against the spell's target.");

    nextFaces(3, 6);
    press(group, 'Roll');
    const [necrotic, slashing] = rolls();
    expect(necrotic?.label).toBe('Witch Mark necrotic damage');
    expect(necrotic?.meta?.withRoll).toBe(slashing?.id);
    expect(dice(necrotic)).toEqual(['d6 [6]']);
    // Every hit: the next prompt has it on again.
    expect(pressed(extra(openDamage('Longsword', 'slashing'), /Witch Mark, concentrating/))).toBe(
      true,
    );
  });

  it('adds its dice at the level it was cast, whatever case its damage type is written in', async () => {
    /** Spirit Shroud's shape in 2024 words: "Radiant", and more dice for a higher slot. */
    const spiritVeil: DataEntity = {
      name: 'Spirit Veil',
      source: 'TST',
      level: 1,
      school: 'N',
      time: [{ number: 1, unit: 'bonus' }],
      range: { type: 'point', distance: { type: 'self' } },
      duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
      entries: [
        'Until the spell ends, you deal an extra {@damage 1d8} Radiant damage whenever you hit with an attack.',
      ],
      entriesHigherLevel: [
        {
          type: 'entries',
          name: 'Using a Higher-Level Spell Slot',
          entries: [
            'The damage increases by {@scaledamage 1d8|1-9|1d8} for each slot level above 1.',
          ],
        },
      ],
    };
    const doc = caster('Spirit Veil');
    doc.play.concentratingOn = { label: 'Spirit Veil', level: 3 };
    await renderSheet(doc, { extra: { spell: [spiritVeil] } });
    render(<RollToast />);
    nextFaces();
    const group = openDamage('Longsword', 'slashing');
    expect(pressed(extra(group, /^\+3d8 radiant Spirit Veil, concentrating/))).toBe(true);
  });

  it('offers a 2014 smite off at its level, and marks it dealt once it rolls', async () => {
    const doc = caster('Burning Smite');
    doc.play.concentratingOn = { label: 'Burning Smite', level: 2 };
    const sheet = await renderSheet(doc, { extra: { spell: [burningSmite] } });
    render(<RollToast />);
    nextFaces();
    noExtra(openDamage('Shortbow', 'piercing'), /Burning Smite/);
    const group = openDamage('Longsword', 'slashing');
    const smite = extra(group, /^\+2d6 fire Burning Smite, next hit/);
    expect(pressed(smite)).toBe(false);
    fireEvent.click(smite);

    nextFaces(3, 4, 5);
    press(group, 'Roll');
    const [fire] = rolls();
    expect(fire?.label).toBe('Burning Smite fire damage');
    expect(dice(fire)).toEqual(['d6 [4, 5]']);
    const saved = await sheet.saved();
    expect(saved.play.concentratingOn).toEqual({ label: 'Burning Smite', level: 2, spent: true });
    expect((await sheet.history())[0]).toBe('Used Burning Smite');

    // The spell runs on, its damage dealt: offered off, and said so.
    const again = extra(
      openDamage('Longsword', 'slashing'),
      /^\+2d6 fire Burning Smite, dealt already/,
    );
    expect(pressed(again)).toBe(false);
  });
});

describe('2014 Great Weapon Master', () => {
  const greatsword: DataEntity = {
    name: 'Greatsword',
    source: 'TST',
    type: 'M',
    weaponCategory: 'martial',
    weapon: true,
    dmg1: '2d6',
    dmgType: 'S',
    property: ['H', '2H'],
  };
  const gwm: DataEntity = {
    name: 'Great Weapon Master',
    source: 'TST',
    entries: [
      'You gain the following benefits:',
      {
        type: 'list',
        items: [
          'On your turn, when you score a critical hit with a melee weapon, you can make one melee weapon attack as a bonus action.',
          "Before you make a melee attack with a heavy weapon that you are proficient with, you can choose to take a -5 penalty to the attack roll. If the attack hits, you add +10 to the attack's damage.",
        ],
      },
    ],
  };
  const heavyHitter = () =>
    fighter((d) => {
      d.equipment = carried({ name: 'Greatsword', source: 'TST' }, LONGSWORD);
      d.feats = [{ ref: { name: 'Great Weapon Master', source: 'TST' }, instanceId: 'f1' }];
    });
  const world = { extra: { baseitem: [greatsword], feat: [gwm] } };
  const claim = /Great Weapon Master, this roll/;
  /** The attack prompt open for `weapon`. */
  const openAttack = (weapon: string) => {
    fireEvent.click(attack(weapon));
    return screen.getByRole('group', { name: `${weapon} attack, choose and roll` });
  };

  it('offers −5 to hit on a heavy weapon, and the +10 it buys rides on the damage, once on a crit', async () => {
    await renderSheet(heavyHitter(), world);
    render(<RollToast />);
    nextFaces();
    // Not on a weapon that is not heavy.
    noExtra(openAttack('Longsword'), claim);
    press(prompt('Longsword attack'), 'Cancel this roll');
    let group = openAttack('Greatsword');
    const minus = extra(group, claim);
    expect(minus.getAttribute('aria-label')).toMatch(/^−5 Great Weapon Master/);
    expect(pressed(minus)).toBe(false);
    fireEvent.click(minus);
    nextFaces(15);
    press(group, 'Roll');
    // +2 proficiency, +3 STR, and the −5.
    const swing = rolls()[0];
    expect(swing?.total).toBe(15);
    expect(swing?.meta?.attack?.claimed).toEqual(['Great Weapon Master']);

    nextFaces();
    fireEvent.click(screen.getByRole('button', { name: 'Roll 2d6+3' }));
    group = prompt('Greatsword slashing damage');
    expect(pressed(extra(group, /^\+10 Great Weapon Master, claimed/))).toBe(true);
    nextFaces(2, 5);
    press(group, 'Roll');
    expect(rolls()[0]?.total).toBe(20);

    // Claimed on a crit, the weapon's dice double and the +10 does not.
    group = openAttack('Greatsword');
    fireEvent.click(extra(group, claim));
    nextFaces(20);
    press(group, 'Roll');
    nextFaces();
    fireEvent.click(screen.getByRole('button', { name: 'Roll 4d6+3' }));
    group = prompt('Greatsword slashing damage');
    expect(group.textContent).toContain('4d6+3 slashing + 10 Great Weapon Master');
    nextFaces(1, 2, 3, 4);
    press(group, 'Roll');
    const dealt = rolls()[0];
    expect(dice(dealt)).toEqual(['d6 [1, 2, 3, 4]']);
    expect(dealt?.total).toBe(23);
  });

  it('adds nothing to the damage of an attack that did not claim it', async () => {
    await renderSheet(heavyHitter(), world);
    render(<RollToast />);
    nextFaces(15);
    rollOn(attack('Greatsword'));
    expect(rolls()[0]?.total).toBe(20);
    expect(rolls()[0]?.meta?.attack?.claimed).toBeUndefined();
    nextFaces();
    fireEvent.click(screen.getByRole('button', { name: 'Roll 2d6+3' }));
    const group = prompt('Greatsword slashing damage');
    noExtra(group, /Great Weapon Master/);
    expect(group.textContent).not.toContain('Great Weapon Master');
  });
});

describe('Savage Attacker', () => {
  const savageAttacker: DataEntity = {
    name: 'Savage Attacker',
    source: 'TST',
    entries: [
      "Once per turn when you hit a target with a weapon, you can roll the weapon's damage dice twice and use either roll against the target.",
    ],
  };
  const savage = () =>
    fighter((d) => {
      d.feats = [{ ref: { name: 'Savage Attacker', source: 'TST' }, instanceId: 'f1' }];
    });

  it('rolls the weapon twice and keeps the higher, once a turn', async () => {
    const sheet = await renderSheet(savage(), { extra: { feat: [savageAttacker] } });
    render(<RollToast />);
    nextFaces();
    let group = openDamage('Longsword', 'slashing');
    const feat = extra(group, /^Savage Attacker, once a turn/);
    expect(pressed(feat)).toBe(true);
    expect(feat.getAttribute('aria-label')).not.toContain('used this turn');

    nextFaces(2, 6);
    press(group, 'Roll');
    const dealt = rolls()[0];
    expect(rolls()).toHaveLength(1);
    expect(dealt?.total).toBe(9);
    expect(dice(dealt)).toEqual(['d8 [6]']);
    expect(dealt?.meta?.cue).toBe('Savage Attacker: rolled 5 and 9, kept 9');
    expect(screen.getByText('Savage Attacker: rolled 5 and 9, kept 9')).toBeTruthy();
    expect((await sheet.saved()).play.turn?.once).toEqual(['feat:savage attacker']);

    // Used this turn: off, and said so; the weapon rolls once.
    group = openDamage('Longsword', 'slashing');
    const used = extra(group, /^Savage Attacker, once a turn, used this turn/);
    expect(pressed(used)).toBe(false);
    nextFaces(4);
    press(group, 'Roll');
    expect(rolls()[0]?.total).toBe(7);
    expect(rolls()[0]?.meta?.cue).toBeUndefined();
  });
});

describe('Action Surge', () => {
  const origin = { label: 'Test', uid: 'feat|test', type: 'feat' } as const;
  /** A level-5 warrior (Extra Attack) with Action Surge's pool and its Use. */
  const surger = () =>
    fighter((d) => {
      d.customEffects = [
        {
          origin,
          kind: 'resource',
          key: 'action-surge',
          label: 'Action Surge',
          max: 1,
          resetOn: 'short',
        },
        { origin, kind: 'action', economy: 'none', label: 'Action Surge' },
      ];
    }, 5);
  const nextAttack = () => screen.queryByRole('button', { name: /^Next attack/ });
  const actionBox = () => screen.getByRole('button', { name: 'Action' });

  it('gives a second Attack action once a turn: attacks 3 and 4', async () => {
    const sheet = await renderSheet(surger());
    render(<RollToast />);
    nextFaces(1);
    rollOn(attack('Longsword'));
    fireEvent.click(nextAttack() as HTMLElement);
    nextFaces(1);
    press(screen.getByRole('group', { name: 'Longsword attack, choose and roll' }), 'Roll');
    // Both of the action's attacks made: no next one.
    expect(nextAttack()).toBeNull();
    expect(actionBox().textContent).toContain('2 of 2 attacks');

    fireEvent.click(screen.getByRole('button', { name: 'Use Action Surge' }));
    const saved = await sheet.saved();
    expect(saved.play.turn).toMatchObject({ attacks: 2, surges: 1 });
    expect(actionBox().textContent).toContain('2 of 4 attacks');

    nextFaces(1);
    rollOn(attack('Longsword'));
    expect((await sheet.history())[0]).toBe('Attacked with Longsword (3 of 4)');
    expect(nextAttack()?.textContent).toContain('Attack 4 of 4');
    fireEvent.click(nextAttack() as HTMLElement);
    nextFaces(1);
    press(screen.getByRole('group', { name: 'Longsword attack, choose and roll' }), 'Roll');
    expect((await sheet.saved()).play.turn?.attacks).toBe(4);
    expect(nextAttack()).toBeNull();
    expect(heldRollStore.getState().held).toBeNull();
  });
});
