// @vitest-environment jsdom
/**
 * U4a's cards for armor, hit points and defenses (ADR-002, board 4): another
 * way to work out Armor Class, Armor Class at least, and Invisible on the
 * Condition immunity card. Each is worked through its boxes, read back from
 * what it wrote, and counted on a sheet beside one without it.
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
