// @vitest-environment jsdom
/**
 * U4a's cards for abilities and proficiencies (ADR-002, board 4): Armor
 * training, Weapon mastery, Half proficiency, and the Ability score card's
 * limit past 20. Each is worked through its boxes, read back from what it
 * wrote, and counted on a sheet beside one without it.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataEntity } from '@/engine/types';
import {
  boxValue,
  change,
  makeCard,
  noProblems,
  renderCards,
  sheetWith,
} from '../../../../tests-fixtures/cardSheet';
import { cards } from './abilities';

vi.mock('@/ui/dialogs', () => ({ askChoice: () => Promise.resolve(undefined) }));

afterEach(cleanup);

const make = (add: string) => makeCard(cards, add);

describe('Ability score, with a limit past 20', () => {
  it('writes the limit, reads it back, and takes it away again', () => {
    const cards = renderCards([{ kind: 'abilityBonus', ability: 'str', amount: 1 }]);
    change('Ability score: Amount', '4');
    change('Ability score: Limit', '24');
    expect(cards.written()).toEqual([{ kind: 'abilityBonus', ability: 'str', amount: 4, max: 24 }]);
    expect(screen.getByText('+4 Strength, up to 24')).toBeTruthy();
    noProblems(cards.written());

    cleanup();
    const again = renderCards(cards.written());
    expect(boxValue('Ability score: Limit')).toBe('24');
    change('Ability score: Limit', '');
    expect(again.written()).toEqual([{ kind: 'abilityBonus', ability: 'str', amount: 4 }]);
  });

  it('shows a limit a file gives that the box has no choice for, as written', () => {
    renderCards([{ kind: 'abilityBonus', ability: 'str', amount: 2, max: 18 }]);
    expect(boxValue('Ability score: Limit')).toBe('18');
    expect(screen.getByRole('option', { name: '18, as written' })).toBeTruthy();
  });

  it('takes a score past 20 on a sheet, where one without the limit stops at 20', () => {
    const strong = (d: { abilities: { base: { str: number } } }) => {
      d.abilities.base.str = 20;
    };
    const past = sheetWith([{ kind: 'abilityBonus', ability: 'str', amount: 4, max: 24 }], {
      setup: strong,
    });
    const held = sheetWith([{ kind: 'abilityBonus', ability: 'str', amount: 4 }], {
      setup: strong,
    });
    expect(past.abilities.str.value).toBe(24);
    expect(held.abilities.str.value).toBe(20);
  });
});

describe('Armor training', () => {
  const pactcaster = (d: { classes: unknown[] }) => {
    // A first-level Pactcaster has no armor training of its own.
    d.classes = [
      {
        ref: { name: 'Pactcaster', source: 'TST' },
        levels: 5,
        hp: ['avg', 'avg', 'avg', 'avg', 'avg'],
      },
    ];
  };

  it('starts as a whole one, writes the armor picked, and reads it back', () => {
    const start = make('Armor training');
    noProblems([start]);
    const cards = renderCards([start]);
    expect(screen.getByText('Trained with heavy armor')).toBeTruthy();
    change('Armor training: Armor', 'shield');
    expect(cards.written()).toEqual([{ kind: 'armorProf', name: 'shield' }]);
    expect(screen.getByText('Trained with shields')).toBeTruthy();
    noProblems(cards.written());

    cleanup();
    renderCards(cards.written());
    expect(boxValue('Armor training: Armor')).toBe('shield');
  });

  it('counts on a sheet in the words a class gives it', () => {
    expect(
      sheetWith([{ kind: 'armorProf', name: 'heavy' }], { setup: pactcaster }).armorProfs,
    ).toEqual(['heavy']);
    expect(sheetWith(undefined, { setup: pactcaster }).armorProfs).toEqual([]);
  });
});

describe('Weapon mastery', () => {
  /** A longsword whose mastery is Sap, carried in hand. */
  const LONGSWORD = {
    name: 'Longsword',
    source: 'HB',
    type: 'M',
    weaponCategory: 'martial',
    weapon: true,
    dmg1: '1d8',
    dmgType: 'S',
    property: ['V'],
    mastery: ['Sap|XPHB'],
  } as DataEntity;
  const carried = {
    extra: { baseitem: [LONGSWORD] },
    setup: (d: { equipment: unknown[] }) => {
      d.equipment = [
        { id: 'w1', ref: { name: 'Longsword', source: 'HB' }, qty: 1, equipped: true },
      ];
    },
  };
  const mastery = (sheet: ReturnType<typeof sheetWith>) =>
    sheet.attacks
      .find((a) => a.label === 'Longsword')
      ?.properties.filter((p) => p.startsWith('mastery'));

  it('starts as a whole one, writes the kind of weapon typed, and reads it back', () => {
    const start = make('Weapon mastery');
    noProblems([start]);
    const cards = renderCards([start]);
    change('Weapon mastery: Kind of weapon', 'dagger');
    expect(screen.getByText('You can use the mastery property of the dagger')).toBeTruthy();
    change('Weapon mastery: Kind of weapon', 'longsword');
    expect(cards.written()).toEqual([{ kind: 'weaponMastery', name: 'longsword' }]);
    noProblems(cards.written());

    cleanup();
    renderCards(cards.written());
    expect(boxValue('Weapon mastery: Kind of weapon')).toBe('longsword');
  });

  it("puts the weapon's mastery on its attack, which it lacks without", () => {
    expect(mastery(sheetWith([{ kind: 'weaponMastery', name: 'longsword' }], carried))).toEqual([
      'mastery: sap',
    ]);
    expect(mastery(sheetWith(undefined, carried))).toEqual([]);
  });
});

describe('Half proficiency', () => {
  it('starts as a whole one, writes its rounding, its checks and its abilities, and reads them back', () => {
    const start = make('Half proficiency');
    noProblems([start]);
    const cards = renderCards([start]);
    expect(
      screen.getByText('Half your proficiency bonus, rounded down, on checks without it'),
    ).toBeTruthy();
    change('Half proficiency: Rounded', 'up');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Half proficiency: Skill checks only' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Half proficiency: Strength' }));
    expect(cards.written()).toEqual([
      { kind: 'halfProf', round: 'up', skillsOnly: true, abilities: ['str'] },
    ]);
    expect(
      screen.getByText(
        'Half your proficiency bonus, rounded up, on Strength skill checks without it',
      ),
    ).toBeTruthy();
    noProblems(cards.written());

    cleanup();
    const again = renderCards(cards.written());
    expect(boxValue('Half proficiency: Rounded')).toBe('up');
    const skills = screen.getByRole('checkbox', { name: 'Half proficiency: Skill checks only' });
    expect((skills as HTMLInputElement).checked).toBe(true);
    const strength = screen.getByRole('checkbox', { name: 'Half proficiency: Strength' });
    expect((strength as HTMLInputElement).checked).toBe(true);
    // Every check again, of every ability: the fields go.
    fireEvent.click(skills);
    fireEvent.click(strength);
    expect(again.written()).toEqual([{ kind: 'halfProf', round: 'up' }]);
  });

  it('adds half the proficiency bonus, rounded as written, to the checks it names alone', () => {
    // Level 5: a proficiency bonus of 3, so 2 rounded up and 1 rounded down.
    const up = sheetWith([{ kind: 'halfProf', round: 'up', skillsOnly: true, abilities: ['str'] }]);
    const down = sheetWith([{ kind: 'halfProf', round: 'down' }]);
    const none = sheetWith(undefined);
    const athletics = (s: typeof none) => s.skills.Athletics?.total.value;
    expect(athletics(up)).toBe((athletics(none) ?? 0) + 2);
    expect(athletics(down)).toBe((athletics(none) ?? 0) + 1);
    // Skill checks of Strength alone: a plain Strength check and Stealth are as they were.
    expect(up.checks.str.total.value).toBe(none.checks.str.total.value);
    expect(up.skills.Stealth?.total.value).toBe(none.skills.Stealth?.total.value);
  });
});

describe('the cards in play', () => {
  it('are not offered where play refuses them', async () => {
    const { moreKinds } = await import('../EffectCards');
    const offered = moreKinds({ inPlay: true, spells: false });
    for (const add of ['Armor training', 'Weapon mastery', 'Half proficiency']) {
      expect(offered).not.toContain(add);
      expect(moreKinds({ inPlay: false, spells: false })).toContain(add);
    }
  });
});
