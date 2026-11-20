// @vitest-environment jsdom
/**
 * U4b's cards for attacks and damage (ADR-002, board 4): an extra die on a hit,
 * the critical hit range, a natural weapon and a bigger unarmed strike, and the
 * Attack rolls and Damage cards' new boxes (one ability's attacks, weapons
 * alone, some kinds of weapon). Each is worked through its boxes, read back
 * from what it wrote, and counted on a sheet beside one without it: what it
 * reaches, and what it leaves alone.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDoc, DerivedSheet } from '@/engine/types';
import {
  boxValue,
  change,
  makeCard,
  noProblems,
  renderCards,
  sheetWith,
} from '../../../../tests-fixtures/cardSheet';
import { moreKinds } from '../EffectCards';
import { cards } from './attacks';

vi.mock('@/ui/dialogs', () => ({ askChoice: () => Promise.resolve(undefined) }));

afterEach(cleanup);

type Eff = Record<string, unknown> & { kind: string };

const make = (add: string) => makeCard(cards, add);
const tick = (label: string) => screen.getByRole('checkbox', { name: label }) as HTMLInputElement;
const line = (text: string) => expect(screen.getByText(text)).toBeTruthy();

/** A Longsword (Strength, melee) and a Shortbow (Dexterity, ranged), carried and held. */
const armed = (d: CharacterDoc) => {
  d.equipment = [
    { id: 'sword', ref: { name: 'Longsword', source: 'TST' } },
    { id: 'bow', ref: { name: 'Shortbow', source: 'TST' } },
  ].map((e) => ({ ...e, qty: 1, equipped: true, attuned: false })) as CharacterDoc['equipment'];
};
const WEAPONS = ['Longsword', 'Shortbow', 'Unarmed Strike'];
const row = (s: DerivedSheet, label: string) => {
  const found = s.attacks.find((a) => a.label === label);
  if (found === undefined) throw new Error(`no ${label} attack`);
  return found;
};
/** How much each attack's to hit rose with `effects`, against the same sheet without them. */
const toHitGained = (effects: Eff[]) => {
  const plain = sheetWith([], { setup: armed });
  const now = sheetWith(effects, { setup: armed });
  return WEAPONS.map((l) => row(now, l).toHit.value - row(plain, l).toHit.value);
};
/** The flat part of a damage roll: "1d8+2" adds 2, and a punch's "3" is all flat. */
const flat = (damage: string) =>
  /^\d+$/.test(damage) ? Number(damage) : Number(/[+-]\d+$/.exec(damage)?.[0] ?? 0);
const damageGained = (effects: Eff[]) => {
  const plain = sheetWith([], { setup: armed });
  const now = sheetWith(effects, { setup: armed });
  return WEAPONS.map((l) => flat(row(now, l).damage) - flat(row(plain, l).damage));
};

describe('Attack rolls, narrowed', () => {
  it("writes one ability's attacks and reads it back, and the sheet adds it to those alone", () => {
    const cards = renderCards([make('Attack rolls')]);
    change('Attack rolls: With', 'dex');
    expect(cards.written()).toEqual([
      { kind: 'attackBonus', amount: 1, scope: 'all', ability: 'dex' },
    ]);
    line('+1 to attack rolls, using Dexterity');
    noProblems(cards.written());
    // The Shortbow uses Dexterity; the Longsword and a punch use Strength.
    expect(toHitGained(cards.written())).toEqual([0, 1, 0]);

    cleanup();
    const again = renderCards(cards.written());
    expect(boxValue('Attack rolls: With')).toBe('dex');
    change('Attack rolls: With', '');
    expect(again.written()).toEqual([{ kind: 'attackBonus', amount: 1, scope: 'all' }]);
  });

  it('writes weapons alone, and some kinds of weapon as typed, key by key', () => {
    const cards = renderCards([make('Attack rolls')]);
    fireEvent.click(tick('Attack rolls: Weapons only'));
    expect(cards.written()).toEqual([
      { kind: 'attackBonus', amount: 1, scope: 'all', weaponsOnly: true },
    ]);
    line('+1 to attack rolls, with a weapon');
    expect(toHitGained(cards.written())).toEqual([1, 1, 0]);

    // A comma and a space stay as typed while the next name is begun.
    const box = 'Attack rolls: Only these weapons';
    for (const typed of ['longsword', 'longsword,', 'longsword, ', 'longsword, sh']) {
      change(box, typed);
      expect(boxValue(box)).toBe(typed);
    }
    change(box, 'longsword, dagger');
    expect(cards.written()).toEqual([
      {
        kind: 'attackBonus',
        amount: 1,
        scope: 'all',
        weaponsOnly: true,
        weapons: ['longsword', 'dagger'],
      },
    ]);
    line('+1 to attack rolls, with longsword or dagger');
    noProblems(cards.written());
    expect(toHitGained(cards.written())).toEqual([1, 0, 0]);

    cleanup();
    const again = renderCards(cards.written());
    expect(boxValue(box)).toBe('longsword, dagger');
    expect(tick('Attack rolls: Weapons only').checked).toBe(true);
    // Emptied, the kinds go.
    change(box, '');
    expect(again.written()[0]).not.toHaveProperty('weapons');
  });

  it('narrows every attack, weapon and spell, by its ability alone', () => {
    const cards = renderCards([
      { kind: 'attackBonus', amount: 1, scope: 'all', weaponsOnly: true, weapons: ['dagger'] },
    ]);
    change('Attack rolls: Which', ':every');
    // A spell attack knows no weapon: the weapon boxes go, and what they held.
    expect(cards.written()).toEqual([
      { kind: 'attackBonus', amount: 1, scope: 'all', attack: 'any' },
    ]);
    expect(screen.queryByLabelText('Attack rolls: Weapons only')).toBeNull();
    expect(screen.queryByLabelText('Attack rolls: Only these weapons')).toBeNull();
    change('Attack rolls: With', 'str');
    line('+1 to every attack roll, weapon and spell, using Strength');
    noProblems(cards.written());
    // Strength's: the Longsword and the punch, not the Shortbow.
    expect(toHitGained(cards.written())).toEqual([1, 0, 1]);
  });

  it("says a file's one class's spells, which it has no box for", () => {
    renderCards([
      { kind: 'attackBonus', amount: 1, scope: 'all', attack: 'any', className: 'Mage' },
    ]);
    line('+1 to every attack roll, weapon and Mage spell');
  });
});

describe('Damage, narrowed', () => {
  it("adds to one ability's weapon damage, as Rage adds to Strength's", () => {
    const cards = renderCards([make('Damage')]);
    change('Damage: Amount', '2');
    change('Damage: With', 'str');
    change('Damage: Which', 'melee');
    expect(cards.written()).toEqual([
      { kind: 'damageBonus', amount: 2, scope: 'melee', ability: 'str' },
    ]);
    line('+2 to melee damage rolls, using Strength');
    noProblems(cards.written());
    // A punch is a melee Strength attack too.
    expect(damageGained(cards.written())).toEqual([2, 0, 2]);
    fireEvent.click(tick('Damage: Weapons only'));
    expect(damageGained(cards.written())).toEqual([2, 0, 0]);
    change('Damage: Only these weapons', 'shortbow');
    expect(damageGained(cards.written())).toEqual([0, 0, 0]);

    cleanup();
    renderCards(cards.written());
    expect(boxValue('Damage: With')).toBe('str');
    expect(boxValue('Damage: Only these weapons')).toBe('shortbow');
  });
});

describe('Extra die on a hit', () => {
  const T = 'Extra die on a hit';
  const riders = (s: DerivedSheet, label: string) =>
    row(s, label).extraDamage.map((r) => `${r.dice} ${r.damageType ?? ''}`.trim());

  it('starts whole, writes its dice, type and attacks, and the sheet rolls it on those hits', () => {
    const start = make(T);
    noProblems([start]);
    const cards = renderCards([start]);
    line('+1d4 fire damage on hits');
    change(`${T}: Dice`, '1d6');
    change(`${T}: Damage`, 'radiant');
    change(`${T}: Which`, 'melee');
    fireEvent.click(tick(`${T}: Weapons only`));
    expect(cards.written()).toEqual([
      { kind: 'damageDie', scope: 'melee', dice: '1d6', damageType: 'radiant', weaponsOnly: true },
    ]);
    line('+1d6 radiant damage on melee weapon hits');
    noProblems(cards.written());
    // It names no ability or kind of weapon, which the reader does not take for it.
    expect(screen.queryByLabelText(`${T}: With`)).toBeNull();
    expect(screen.queryByLabelText(`${T}: Only these weapons`)).toBeNull();

    const s = sheetWith(cards.written(), { setup: armed });
    expect(riders(s, 'Longsword')).toEqual(['1d6 radiant']);
    expect(riders(s, 'Shortbow')).toEqual([]);
    expect(riders(s, 'Unarmed Strike')).toEqual([]);

    cleanup();
    const again = renderCards(cards.written());
    expect(boxValue(`${T}: Dice`)).toBe('1d6');
    expect(boxValue(`${T}: Damage`)).toBe('radiant');
    // The weapon's own type: the field goes.
    change(`${T}: Damage`, '');
    expect(again.written()[0]).not.toHaveProperty('damageType');
    line('+1d6 damage on melee weapon hits');
    noProblems(again.written());
  });

  it('shows a type a file gives that is not on the list as written', () => {
    renderCards([{ kind: 'damageDie', scope: 'all', dice: '1d4', damageType: 'sonic' }]);
    expect(boxValue(`${T}: Damage`)).toBe('sonic');
    expect(screen.getByRole('option', { name: 'sonic, as written' })).toBeTruthy();
  });
});

describe('Critical hit range', () => {
  const T = 'Critical hit range';
  it('writes the least roll that is a critical hit, and the sheet keeps the lowest', () => {
    const start = make(T);
    noProblems([start]);
    const cards = renderCards([start]);
    line('A critical hit on a 19 or higher');
    change(`${T}: On a roll of at least`, '18');
    expect(cards.written()).toEqual([{ kind: 'critRange', min: 18 }]);
    line('A critical hit on a 18 or higher');
    noProblems(cards.written());
    expect(sheetWith([]).critRange).toBeUndefined();
    expect(sheetWith(cards.written()).critRange).toEqual({ min: 18, origin: 'Card Feat' });
    // Beside a 19, the 18 counts.
    expect(sheetWith([...cards.written(), { kind: 'critRange', min: 19 }]).critRange?.min).toBe(18);

    cleanup();
    renderCards(cards.written());
    expect(boxValue(`${T}: On a roll of at least`)).toBe('18');
  });
});

describe('Natural weapon', () => {
  const T = 'Natural weapon';
  it('writes its name, dice, type and ability, and the sheet lists it as an attack', () => {
    const start = make(T);
    noProblems([start]);
    const cards = renderCards([start]);
    line('Claws deal 1d6 slashing damage, using Strength');
    change(`${T}: Name`, 'Bite');
    change(`${T}: Dice`, '1d8');
    change(`${T}: Damage`, 'piercing');
    change(`${T}: With`, 'con');
    expect(cards.written()).toEqual([
      { kind: 'naturalWeapon', label: 'Bite', dice: '1d8', damageType: 'piercing', ability: 'con' },
    ]);
    line('Bite deal 1d8 piercing damage, using Constitution');
    noProblems(cards.written());

    expect(sheetWith([]).attacks.some((a) => a.label === 'Bite')).toBe(false);
    const bite = row(sheetWith(cards.written()), 'Bite');
    // Constitution 14 adds +2, with proficiency, as a natural weapon always has.
    expect(bite.damage).toBe('1d8+2');
    expect(bite.damageType).toBe('piercing');
    expect(bite.ability).toBe('con');

    cleanup();
    renderCards(cards.written());
    expect(boxValue(`${T}: Name`)).toBe('Bite');
    expect(boxValue(`${T}: With`)).toBe('con');
  });

  it('shows Strength for one a file gives with no ability, as the reader reads it', () => {
    const cards = renderCards([
      { kind: 'naturalWeapon', label: 'Horns', dice: '1d6', damageType: 'piercing' },
    ]);
    expect(boxValue(`${T}: With`)).toBe('str');
    line('Horns deal 1d6 piercing damage, using Strength');
    noProblems(cards.written());
  });
});

describe('Bigger unarmed strike', () => {
  const T = 'Bigger unarmed strike';
  it("writes a die, and the sheet's Unarmed Strike rolls it", () => {
    const start = make(T);
    noProblems([start]);
    const cards = renderCards([start]);
    change(`${T}: Dice`, '1d8');
    change(`${T}: Shown as`, 'Tavern Brawler');
    expect(cards.written()).toEqual([
      { kind: 'unarmedDamage', label: 'Tavern Brawler', dice: '1d8' },
    ]);
    line('Your unarmed strike deals 1d8');
    noProblems(cards.written());

    const plain = row(sheetWith([]), 'Unarmed Strike');
    const punch = row(sheetWith(cards.written()), 'Unarmed Strike');
    expect(plain.damage).not.toContain('1d8');
    expect(punch.damage).toBe('1d8+2');
    expect(punch.properties).toContain('tavern brawler');

    cleanup();
    renderCards(cards.written());
    expect(boxValue(`${T}: Dice`)).toBe('1d8');
  });

  it('says a die the sheet cannot weigh does not count', () => {
    const cards = renderCards([make(T)]);
    const why = /dice written as 1d8, a number of dice and their size alone/;
    for (const dice of ['d8', '1d8+1']) {
      change(`${T}: Dice`, dice);
      expect(screen.getByText(why)).toBeTruthy();
      // The reader takes it, and the sheet's punch stays as it was.
      noProblems(cards.written());
      expect(row(sheetWith(cards.written()), 'Unarmed Strike').damage).toBe(
        row(sheetWith([]), 'Unarmed Strike').damage,
      );
    }
    change(`${T}: Dice`, '1d10');
    expect(screen.queryByText(why)).toBeNull();
    // The reader trims what is typed, so spaces round good dice still count.
    change(`${T}: Dice`, ' 1d10 ');
    expect(screen.queryByText(why)).toBeNull();
    expect(row(sheetWith(cards.written()), 'Unarmed Strike').damage).toBe(
      row(sheetWith([{ kind: 'unarmedDamage', label: 'Fists', dice: '1d10' }]), 'Unarmed Strike')
        .damage,
    );
  });
});

describe('where the attack cards are offered', () => {
  it('offers the in-play ones in play, and leaves out what only a build gives', () => {
    const inPlay = moreKinds({ inPlay: true, spells: false });
    expect(inPlay).toEqual(
      expect.arrayContaining([
        'Attack rolls',
        'Damage',
        'Extra die on a hit',
        'Critical hit range',
      ]),
    );
    expect(inPlay).not.toContain('Natural weapon');
    expect(inPlay).not.toContain('Bigger unarmed strike');
    const own = moreKinds({ inPlay: false, spells: false });
    expect(own).toEqual(expect.arrayContaining(['Natural weapon', 'Bigger unarmed strike']));
  });
});
