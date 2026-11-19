// @vitest-environment jsdom
/**
 * U4a's cards for armor, hit points and defenses (ADR-002, board 4): another
 * way to work out Armor Class, Armor Class at least, and Invisible on the
 * Condition immunity card. Each is worked through its boxes, read back from
 * what it wrote, and counted on a sheet beside one without it.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { conditionMechanics } from '@/engine/conditions';
import { readMoments } from '@/engine/moments';
import {
  boxValue,
  change,
  makeCard,
  noProblems,
  renderCards,
  sheetWith,
} from '../../../../tests-fixtures/cardSheet';
import { EffectCards, moreKinds } from '../EffectCards';
import { cards } from './defenses';

vi.mock('@/ui/dialogs', () => ({ askChoice: () => Promise.resolve(undefined) }));

afterEach(cleanup);

const make = (add: string) => makeCard(cards, add);
const tick = (label: string) => screen.getByRole('checkbox', { name: label }) as HTMLInputElement;

describe('Another way to work out AC', () => {
  const TITLE = 'Another way to work out AC';

  it('starts as a whole one, writes its base, abilities and Dexterity cap, and reads them back', () => {
    const start = make(TITLE);
    noProblems([start]);
    const cards = renderCards([start]);
    expect(screen.getByText('Armor Class is 13 plus Dexterity')).toBeTruthy();
    change(`${TITLE}: Base`, '12');
    fireEvent.click(tick(`${TITLE}: Constitution`));
    change(`${TITLE}: Dexterity counts`, '2');
    expect(cards.written()).toEqual([
      { kind: 'acFormula', base: 12, addAbilities: ['dex', 'con'], dexMax: 2 },
    ]);
    expect(
      screen.getByText('Armor Class is 12 plus Dexterity and Constitution (Dexterity up to +2)'),
    ).toBeTruthy();
    noProblems(cards.written());

    cleanup();
    const again = renderCards(cards.written());
    expect(boxValue(`${TITLE}: Base`)).toBe('12');
    expect(boxValue(`${TITLE}: Dexterity counts`)).toBe('2');
    expect(tick(`${TITLE}: Dexterity`).checked).toBe(true);
    expect(tick(`${TITLE}: Constitution`).checked).toBe(true);
    // No cap and no ability: Armor Class is the base alone, as natural armor of 17.
    change(`${TITLE}: Dexterity counts`, '');
    fireEvent.click(tick(`${TITLE}: Dexterity`));
    fireEvent.click(tick(`${TITLE}: Constitution`));
    change(`${TITLE}: Base`, '17');
    expect(again.written()).toEqual([{ kind: 'acFormula', base: 17 }]);
    expect(screen.getByText('Armor Class is 17')).toBeTruthy();
    noProblems(again.written());
  });

  it('keeps the Dexterity cap with Dexterity: picking one ticks it, unticking takes it away', () => {
    const cards = renderCards([{ kind: 'acFormula', base: 12, addAbilities: ['con'] }]);
    change(`${TITLE}: Dexterity counts`, '2');
    expect(cards.written()).toEqual([
      { kind: 'acFormula', base: 12, addAbilities: ['dex', 'con'], dexMax: 2 },
    ]);
    expect(tick(`${TITLE}: Dexterity`).checked).toBe(true);
    fireEvent.click(tick(`${TITLE}: Dexterity`));
    expect(cards.written()).toEqual([{ kind: 'acFormula', base: 12, addAbilities: ['con'] }]);
    expect(boxValue(`${TITLE}: Dexterity counts`)).toBe('');
    expect(screen.getByText('Armor Class is 12 plus Constitution')).toBeTruthy();
  });

  it('says a cap of +0 as the sheet counts it: a negative Dexterity still counts', () => {
    const capped = [{ kind: 'acFormula', base: 13, addAbilities: ['dex'], dexMax: 0 }];
    renderCards(capped);
    expect(screen.getByText('Armor Class is 13 plus Dexterity (Dexterity up to +0)')).toBeTruthy();
    const dex = (n: number) => (d: { abilities: { base: { dex: number } } }) => {
      d.abilities.base.dex = n;
    };
    // Dexterity 8 (-1) counts; Dexterity 16 (+3) is held to +0.
    expect(sheetWith(capped, { setup: dex(8) }).ac.value).toBe(12);
    expect(sheetWith(capped).ac.value).toBe(13);
  });

  it('counts on a sheet when it is the best way, its Dexterity held to the cap', () => {
    // Dexterity 16 (+3) and Constitution 14 (+2); unarmored, 13.
    expect(sheetWith(undefined).ac.value).toBe(13);
    expect(
      sheetWith([{ kind: 'acFormula', base: 12, addAbilities: ['dex', 'con'], dexMax: 2 }]).ac
        .value,
    ).toBe(16);
    expect(sheetWith([{ kind: 'acFormula', base: 17 }]).ac.value).toBe(17);
  });
});

describe('Armor Class is at least', () => {
  const TITLE = 'Armor Class is at least';

  it('starts as a whole one, writes the least, and reads it back', () => {
    const start = make(TITLE);
    noProblems([start]);
    const cards = renderCards([start]);
    expect(screen.getByText('Armor Class is at least 16')).toBeTruthy();
    change(`${TITLE}: At least`, '17');
    expect(cards.written()).toEqual([{ kind: 'acMin', min: 17 }]);
    noProblems(cards.written());

    cleanup();
    renderCards(cards.written());
    expect(boxValue(`${TITLE}: At least`)).toBe('17');
  });

  it('raises a lower Armor Class to it on a sheet, and leaves a higher one', () => {
    expect(sheetWith([{ kind: 'acMin', min: 17 }]).ac.value).toBe(17);
    expect(sheetWith([{ kind: 'acMin', min: 11 }]).ac.value).toBe(13);
  });
});

describe('Condition immunity', () => {
  it('offers Invisible, writes it, and the sheet holds it', () => {
    const cards = renderCards([{ kind: 'conditionImmune', condition: 'Frightened' }]);
    change('Condition immunity: Condition', 'Invisible');
    expect(cards.written()).toEqual([{ kind: 'conditionImmune', condition: 'Invisible' }]);
    expect(screen.getByText('Immune to the Invisible condition')).toBeTruthy();
    noProblems(cards.written());

    cleanup();
    renderCards(cards.written());
    expect(boxValue('Condition immunity: Condition')).toBe('Invisible');
    // Offered as a choice of its own, not as written.
    expect(screen.queryByRole('option', { name: 'Invisible, as written' })).toBeNull();

    const immune = (s: ReturnType<typeof sheetWith>) =>
      s.conditionImmunities.map((c) => c.condition);
    expect(immune(sheetWith(cards.written()))).toContain('Invisible');
    expect(immune(sheetWith(undefined))).not.toContain('Invisible');
  });
});

describe('Temporary HP each turn', () => {
  const TITLE = 'Temporary HP each turn';
  const NOTE = /^This counts only in play/;
  const FOUR = { kind: 'tempHpEachTurn', amount: 4 };

  it('starts as a whole one, writes its amount, and reads it back', () => {
    const start = make(TITLE);
    noProblems([start]);
    const cards = renderCards([start]);
    expect(screen.getByText('5 temporary hit points at the start of each turn')).toBeTruthy();
    change(`${TITLE}: Amount`, '4');
    expect(cards.written()).toEqual([FOUR]);
    expect(screen.getByText('4 temporary hit points at the start of each turn')).toBeTruthy();
    noProblems(cards.written());

    cleanup();
    renderCards(cards.written());
    expect(boxValue(`${TITLE}: Amount`)).toBe('4');
  });

  it("says on an entry's own list that it counts only in play", () => {
    renderCards([FOUR]);
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it('says, as what a pick gives, that it counts only in play, without a Counts when it has not', () => {
    renderCards([{ kind: 'pick', id: 'gift', ask: 'skill', gives: [FOUR] }]);
    expect(screen.getByText('This counts only in play, not as what a pick gives.')).toBeTruthy();
    expect(screen.queryByText(/Counts when, or give it/)).toBeNull();
  });

  it("says nothing of it on a spell's while-it-lasts list, where it counts", () => {
    renderCards([FOUR], { inPlay: true });
    expect(screen.getByText('4 temporary hit points at the start of each turn')).toBeTruthy();
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(moreKinds({ inPlay: true, spells: true })).toContain(TITLE);
  });

  it('says nothing of it on a condition, which never gives it, so More does not offer it', () => {
    // As the condition editor asks (`countsOnACondition`).
    const counts = (e: unknown) =>
      conditionMechanics({ castGuidance: { v: 1, effects: [e] } }).problems.length === 0;
    expect(counts(FOUR)).toBe(false);
    // One a file already holds is still drawn, without the note.
    renderCards([FOUR], { inPlay: true, counts });
    expect(screen.getByText('4 temporary hit points at the start of each turn')).toBeTruthy();
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(moreKinds({ inPlay: true, spells: false, counts })).not.toContain(TITLE);
  });

  it('drops the note once Counts when puts it on at a moment', () => {
    let held: unknown[] = [];
    function Host() {
      const [effects, setEffects] = useState<unknown[]>([FOUR]);
      const [moments, setMoments] = useState<unknown[]>([]);
      return (
        <EffectCards
          effects={effects}
          readOnly={false}
          onChange={setEffects}
          moments={moments}
          onMoments={(next, list) => {
            held = next;
            setMoments(next);
            if (list !== undefined) setEffects(list);
          }}
          momentName="Card Feat"
        />
      );
    }
    render(<Host />);
    expect(screen.getByText(NOTE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Counts when' }));
    change(`${TITLE}: Put on when`, 'zeroHp');
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(held).toEqual([
      { at: 'zeroHp', do: [{ kind: 'addEffect', name: 'Card Feat', effects: [FOUR] }] },
    ]);
    // The moment reader takes it: once the moment comes it is in play.
    expect(readMoments(held, 'Card Feat').problems).toEqual([]);
  });
});
