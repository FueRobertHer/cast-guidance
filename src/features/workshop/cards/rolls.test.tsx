// @vitest-environment jsdom
/**
 * U4b's cards for rolls (ADR-002, board 4): an ability check bonus and a die
 * offered after a roll. Each is worked through its boxes, read back from what
 * it wrote, and counted on a sheet beside one without it: the checks it
 * reaches and those it does not, and the roll prompt offering the die.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { conditionMechanics } from '@/engine/conditions';
import { rollEffects } from '@/engine/playRules';
import {
  boxValue,
  change,
  makeCard,
  noProblems,
  renderCards,
  sheetWith,
} from '../../../../tests-fixtures/cardSheet';
import { moreKinds } from '../EffectCards';
import { cards } from './rolls';

vi.mock('@/ui/dialogs', () => ({ askChoice: () => Promise.resolve(undefined) }));

afterEach(cleanup);

type Eff = Record<string, unknown> & { kind: string };

const make = (add: string) => makeCard(cards, add);
const tick = (label: string) => screen.getByRole('checkbox', { name: label }) as HTMLInputElement;
const line = (text: string) => expect(screen.getByText(text)).toBeTruthy();
const options = (label: string) =>
  Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.value);

describe('Ability check bonus', () => {
  const T = 'Ability check bonus';
  /** What each check rose by: Athletics, Stealth, a plain Strength check, a plain Wisdom check, initiative. */
  const gained = (effects: Eff[]) => {
    const plain = sheetWith([]);
    const now = sheetWith(effects);
    const skill = (n: string) =>
      (now.skills[n]?.total.value ?? NaN) - (plain.skills[n]?.total.value ?? NaN);
    return [
      skill('Athletics'),
      skill('Stealth'),
      now.checks.str.total.value - plain.checks.str.total.value,
      now.checks.wis.total.value - plain.checks.wis.total.value,
      now.initiative.value - plain.initiative.value,
    ];
  };

  it("writes one skill's checks, and the sheet adds it to that skill alone", () => {
    const start = make(T);
    noProblems([start]);
    const cards = renderCards([start]);
    line('+1 to Athletics checks');
    change(`${T}: Amount`, '2');
    expect(cards.written()).toEqual([{ kind: 'checkBonus', amount: 2, skills: ['Athletics'] }]);
    expect(gained(cards.written())).toEqual([2, 0, 0, 0, 0]);

    cleanup();
    const again = renderCards(cards.written());
    expect(boxValue(`${T}: Checks`)).toBe('skill:Athletics');
    change(`${T}: Checks`, 'skill:Stealth');
    expect(again.written()).toEqual([{ kind: 'checkBonus', amount: 2, skills: ['Stealth'] }]);
    noProblems(again.written());
    expect(gained(again.written())).toEqual([0, 2, 0, 0, 0]);
  });

  it("writes one ability's checks, or every check, as the reader takes one of them", () => {
    const cards = renderCards([make(T)]);
    change(`${T}: Checks`, 'ability:str');
    expect(cards.written()).toEqual([{ kind: 'checkBonus', amount: 1, ability: 'str' }]);
    line('+1 to Strength checks');
    noProblems(cards.written());
    // Its skill and its plain check, not another ability's.
    expect(gained(cards.written())).toEqual([1, 0, 1, 0, 0]);
    change(`${T}: Checks`, 'every');
    expect(cards.written()).toEqual([{ kind: 'checkBonus', amount: 1, every: true }]);
    line('+1 to every ability check');
    noProblems(cards.written());
    expect(gained(cards.written())).toEqual([1, 1, 1, 1, 1]);
  });

  it("shows a file's several skills as written, and a pick replaces them", () => {
    const cards = renderCards([{ kind: 'checkBonus', amount: 1, skills: ['Arcana', 'History'] }]);
    line('+1 to Arcana and History checks');
    expect(boxValue(`${T}: Checks`)).toBe('');
    expect(
      screen.getByRole('option', { name: 'Arcana and History checks, as written' }),
    ).toBeTruthy();
    change(`${T}: Checks`, 'every');
    expect(cards.written()).toEqual([{ kind: 'checkBonus', amount: 1, every: true }]);
  });
});

describe('Die offered after a roll', () => {
  const T = 'Die offered after a roll';
  const offered = (effects: Eff[], test: Parameters<typeof rollEffects>[1]) =>
    rollEffects(sheetWith(effects), test).offers.filter((o) => o.source === 'Card Feat');
  const caption = /Used once only in play/;

  it('starts on every failed check, writes its dice, roll and timing, and the prompt offers it', () => {
    const start = make(T);
    noProblems([start]);
    const cards = renderCards([start]);
    line('Add 1d4 to your ability checks, after you see the d20, if it failed');
    expect(offered([start], { kind: 'check', ability: 'int' })).toEqual([
      { dice: '1d4', source: 'Card Feat', once: false, ifFailed: true },
    ]);
    // On an entry's own list the sheet spends no die once: no tick to promise it.
    expect(screen.queryByLabelText(`${T}: Used once`)).toBeNull();
    change(`${T}: Dice`, '1d6');
    change(`${T}: On`, 'save');
    change(`${T}: Ability`, 'wis');
    change(`${T}: Offered`, '');
    expect(cards.written()).toEqual([
      { kind: 'rollOffer', dice: '1d6', on: { rolls: ['save'], abilities: ['wis'] } },
    ]);
    line('Add 1d6 to your Wisdom saving throws, after you see the d20');
    noProblems(cards.written());

    expect(offered(cards.written(), { kind: 'save', ability: 'wis' })).toEqual([
      { dice: '1d6', source: 'Card Feat', once: false, ifFailed: false },
    ]);
    expect(offered(cards.written(), { kind: 'save', ability: 'dex' })).toEqual([]);
    expect(offered(cards.written(), { kind: 'check', ability: 'wis' })).toEqual([]);

    cleanup();
    const again = renderCards(cards.written());
    expect(boxValue(`${T}: Dice`)).toBe('1d6');
    expect(boxValue(`${T}: On`)).toBe('save');
    expect(boxValue(`${T}: Ability`)).toBe('wis');
    expect(boxValue(`${T}: Offered`)).toBe('');
    expect(again.written()).toEqual(cards.written());
  });

  it('is used once in play, as Guidance is', () => {
    const cards = renderCards([make(T)], { inPlay: true });
    fireEvent.click(tick(`${T}: Used once`));
    expect(cards.written()).toEqual([
      { kind: 'rollOffer', dice: '1d4', on: { rolls: ['check'] }, ifFailed: true, once: true },
    ]);
    line('Add 1d4 to one of your ability checks, after you see the d20, if it failed');
    expect(screen.queryByText(caption)).toBeNull();
    noProblems(cards.written());
  });

  it('is used once when a moment puts it on (Counts when), which spends it', () => {
    renderCards([], {
      moments: [
        { at: 'zeroHp', do: [{ kind: 'addEffect', name: 'Card Feat', effects: [make(T)] }] },
      ],
      onMoments: () => {},
      momentName: 'Card Feat',
    });
    expect(tick(`${T}: Used once`).checked).toBe(false);
    expect(screen.queryByText(caption)).toBeNull();
  });

  it("shows a file's once on an entry's own list, says it is not, and takes it back", () => {
    const cards = renderCards([
      { kind: 'rollOffer', dice: '1d4', on: { rolls: ['check'] }, once: true },
    ]);
    expect(tick(`${T}: Used once`).checked).toBe(true);
    expect(screen.getByText(caption)).toBeTruthy();
    fireEvent.click(tick(`${T}: Used once`));
    expect(cards.written()).toEqual([{ kind: 'rollOffer', dice: '1d4', on: { rolls: ['check'] } }]);
    expect(screen.queryByLabelText(`${T}: Used once`)).toBeNull();
    expect(screen.queryByText(caption)).toBeNull();
  });

  it('counts as a new card on a condition, which offers a die on every roll', () => {
    expect(conditionMechanics({ castGuidance: { v: 1, effects: [make(T)] } }).problems).toEqual([]);
  });

  it('never waits on a failed initiative, which cannot fail', () => {
    const cards = renderCards([make(T)]);
    change(`${T}: On`, 'initiative');
    expect(cards.written()).toEqual([
      { kind: 'rollOffer', dice: '1d4', on: { rolls: ['check'], initiative: true } },
    ]);
    expect(options(`${T}: Offered`)).toEqual(['']);
    noProblems(cards.written());
    expect(offered(cards.written(), { kind: 'initiative' })).toEqual([
      { dice: '1d4', source: 'Card Feat', once: false, ifFailed: false },
    ]);
    cleanup();
    // A file's, which the prompt offers with "if it failed", is kept as written.
    renderCards([
      {
        kind: 'rollOffer',
        dice: '1d4',
        on: { rolls: ['check'], initiative: true },
        ifFailed: true,
      },
    ]);
    expect(screen.getByRole('option', { name: 'After a failed roll, as written' })).toBeTruthy();
  });

  it('offers the rolls a prompt can wait on: no death or concentration save', () => {
    renderCards([make(T)]);
    expect(options(`${T}: On`)).toEqual(['attack', 'save', 'check', 'proficient', 'initiative']);
  });
});

describe('where the roll cards are offered', () => {
  it('offers both in play', () => {
    expect(moreKinds({ inPlay: true, spells: false })).toEqual(
      expect.arrayContaining(['Ability check bonus', 'Die offered after a roll']),
    );
  });
});
