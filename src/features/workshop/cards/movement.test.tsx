// @vitest-environment jsdom
/**
 * U4a's cards for speed, senses and initiative (ADR-002, board 4): Speed
 * multiplied, Passive Perception, and the Speed and Initiative cards' new
 * boxes (a speed only out of armor, the proficiency bonus on Initiative). Each
 * is worked through its boxes, read back from what it wrote, and counted on a
 * sheet beside one without it.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  boxValue,
  change,
  makeCard,
  noProblems,
  renderCards,
  sheetWith,
} from '../../../../tests-fixtures/cardSheet';
import { moreKinds } from '../EffectCards';
import { cards } from './movement';

vi.mock('@/ui/dialogs', () => ({ askChoice: () => Promise.resolve(undefined) }));

afterEach(cleanup);

const make = (add: string) => makeCard(cards, add);

describe('Initiative, with the proficiency bonus', () => {
  it('puts the proficiency bonus in the amount’s place, and a number back', () => {
    const cards = renderCards([{ kind: 'initiativeBonus', amount: 2 }]);
    const tick = () =>
      screen.getByRole('checkbox', {
        name: 'Initiative: Your proficiency bonus instead',
      }) as HTMLInputElement;
    fireEvent.click(tick());
    expect(cards.written()).toEqual([{ kind: 'initiativeBonus', profBonus: true }]);
    expect(
      screen.getByText('Your proficiency bonus to Initiative, once however many add it'),
    ).toBeTruthy();
    expect(boxValue('Initiative: Amount')).toBe('');
    noProblems(cards.written());

    cleanup();
    const again = renderCards(cards.written());
    expect(tick().checked).toBe(true);
    fireEvent.click(tick());
    expect(again.written()).toEqual([{ kind: 'initiativeBonus', amount: 1 }]);
    // An amount typed in takes the proficiency bonus's place, as before.
    fireEvent.click(tick());
    change('Initiative: Amount', '3');
    expect(again.written()).toEqual([{ kind: 'initiativeBonus', amount: 3 }]);
    expect(tick().checked).toBe(false);
  });

  it('adds the proficiency bonus to Initiative on a sheet', () => {
    // Dexterity 16 (+3), and at level 5 a proficiency bonus of 3.
    expect(sheetWith(undefined).initiative.value).toBe(3);
    expect(sheetWith([{ kind: 'initiativeBonus', profBonus: true }]).initiative.value).toBe(6);
  });
});

describe('Speed, only out of armor', () => {
  const shield = (d: { equipment: unknown[] }) => {
    d.equipment = [{ id: 's1', ref: { name: 'Shield', source: 'TST' }, qty: 1, equipped: true }];
  };
  const chain = (d: { equipment: unknown[] }) => {
    d.equipment = [
      { id: 'a1', ref: { name: 'Chain Mail', source: 'TST' }, qty: 1, equipped: true },
    ];
  };

  it('writes what it cannot be worn with, reads it back, and takes it away', () => {
    const cards = renderCards([{ kind: 'speedBonus', amount: 10 }]);
    change('Speed: Armor', 'armorOrShield');
    expect(cards.written()).toEqual([{ kind: 'speedBonus', amount: 10, unless: 'armorOrShield' }]);
    expect(
      screen.getByText('+10 ft to your Speed, while you wear no armor and hold no shield'),
    ).toBeTruthy();
    noProblems(cards.written());
    change('Speed: Armor', 'heavyArmor');
    expect(screen.getByText('+10 ft to your Speed, unless you wear heavy armor')).toBeTruthy();

    cleanup();
    const again = renderCards(cards.written());
    expect(boxValue('Speed: Armor')).toBe('heavyArmor');
    change('Speed: Armor', '');
    expect(again.written()).toEqual([{ kind: 'speedBonus', amount: 10 }]);
  });

  it('counts on a sheet out of armor, and not with what it names worn', () => {
    const bare = [{ kind: 'speedBonus', amount: 10, unless: 'armorOrShield' }];
    const heavy = [{ kind: 'speedBonus', amount: 10, unless: 'heavyArmor' }];
    expect(sheetWith(bare).speedWalk.value).toBe(40);
    expect(sheetWith(bare, { setup: shield }).speedWalk.value).toBe(30);
    expect(sheetWith(heavy, { setup: shield }).speedWalk.value).toBe(40);
    expect(sheetWith(heavy, { setup: chain }).speedWalk.value).toBe(30);
  });
});

describe('Speed multiplied', () => {
  const TITLE = 'Speed multiplied';

  it('starts as a whole one, writes a number with a point as a number, and reads it back', () => {
    const start = make(TITLE);
    noProblems([start]);
    const cards = renderCards([start]);
    expect(screen.getByText('Walking speed times 2')).toBeTruthy();
    change(`${TITLE}: Times`, '1.5');
    expect(cards.written()).toEqual([{ kind: 'speedMultiplier', factor: 1.5 }]);
    expect(screen.getByText('Walking speed times 1.5')).toBeTruthy();
    expect(screen.queryByText(/This does not count yet/)).toBeNull();
    noProblems(cards.written());

    cleanup();
    renderCards(cards.written());
    expect(boxValue(`${TITLE}: Times`)).toBe('1.5');
  });

  it('says a factor of 1 or less does not count, as the sheet never slows a speed this way', () => {
    const cards = renderCards([make(TITLE)]);
    change(`${TITLE}: Times`, '0.5');
    expect(cards.written()).toEqual([{ kind: 'speedMultiplier', factor: 0.5 }]);
    expect(screen.getByText(/This does not count yet: times a number above 1/)).toBeTruthy();
    expect(sheetWith(cards.written()).speedMultiplier.factor).toBe(1);
  });

  it('says what the reader refuses in words it reads', () => {
    renderCards([make(TITLE)]);
    change(`${TITLE}: Times`, 'twice');
    expect(
      screen.getByText(/This does not count yet: .*is a number above 0, at most 10/),
    ).toBeTruthy();
  });

  it('multiplies walking speed on a sheet', () => {
    expect(sheetWith(undefined).speedMultiplier).toEqual({ factor: 1, sources: [] });
    expect(sheetWith([{ kind: 'speedMultiplier', factor: 2 }]).speedMultiplier).toEqual({
      factor: 2,
      sources: ['Card Feat'],
    });
  });
});

describe('Passive Perception', () => {
  const TITLE = 'Passive Perception';

  it('starts as a whole one, writes its amount, and reads it back', () => {
    const start = make(TITLE);
    noProblems([start]);
    const cards = renderCards([start]);
    expect(screen.getByText('+5 to passive Perception')).toBeTruthy();
    change(`${TITLE}: Amount`, '3');
    expect(cards.written()).toEqual([{ kind: 'passivePerceptionBonus', amount: 3 }]);
    noProblems(cards.written());

    cleanup();
    renderCards(cards.written());
    expect(boxValue(`${TITLE}: Amount`)).toBe('3');
  });

  it('raises passive Perception on a sheet', () => {
    const was = sheetWith(undefined).passivePerception.value;
    expect(sheetWith([{ kind: 'passivePerceptionBonus', amount: 3 }]).passivePerception.value).toBe(
      was + 3,
    );
  });

  it('is not offered in play, where it does not count, and Speed multiplied is', () => {
    expect(moreKinds({ inPlay: true, spells: false })).not.toContain(TITLE);
    expect(moreKinds({ inPlay: true, spells: false })).toContain('Speed multiplied');
  });
});
