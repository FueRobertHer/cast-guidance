// @vitest-environment jsdom
/**
 * U4b's cards for actions and uses (ADR-002, board 4): one more action and
 * uses back on a short rest. Each is worked through its boxes, read back from
 * what it wrote, and counted on a sheet beside one without it.
 */
import { cleanup, screen } from '@testing-library/react';
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
import { cards } from './actions';

vi.mock('@/ui/dialogs', () => ({ askChoice: () => Promise.resolve(undefined) }));

afterEach(cleanup);

type Eff = Record<string, unknown> & { kind: string };

const make = (add: string) => makeCard(cards, add);
const line = (text: string) => expect(screen.getByText(text)).toBeTruthy();
const UNKNOWN = /No pool here has this key/;

describe('One more action', () => {
  const T = 'One more action';
  const extra = (effects: Eff[]) =>
    sheetWith(effects).extraActions.filter((a) => a.origin === 'Card Feat');

  it('writes what it is used for and a note, and the sheet lists it', () => {
    const start = make(T);
    noProblems([start]);
    const cards = renderCards([start]);
    line('One more action: Attack once, Dash or Disengage');
    change(`${T}: Used for`, 'Dash or Hide');
    change(`${T}: Note`, 'Only while hasted');
    expect(cards.written()).toEqual([
      { kind: 'extraAction', label: 'Dash or Hide', note: 'Only while hasted' },
    ]);
    line('One more action: Dash or Hide. Only while hasted');
    noProblems(cards.written());
    expect(extra([])).toEqual([]);
    expect(extra(cards.written())).toEqual([
      { label: 'Dash or Hide', note: 'Only while hasted', origin: 'Card Feat' },
    ]);

    cleanup();
    const again = renderCards(cards.written());
    expect(boxValue(`${T}: Used for`)).toBe('Dash or Hide');
    expect(boxValue(`${T}: Note`)).toBe('Only while hasted');
    // Emptied, the note is gone.
    change(`${T}: Note`, '  ');
    expect(again.written()).toEqual([{ kind: 'extraAction', label: 'Dash or Hide' }]);
    noProblems(again.written());
  });
});

describe('Uses back on a short rest', () => {
  const T = 'Uses back on a short rest';
  const POOL = { kind: 'resource', key: 'grit', label: 'Grit', max: 3, reset: 'long' };
  const OTHER = { kind: 'resource', key: 'luck', label: 'Luck', max: 2, reset: 'long' };
  const pool = (effects: Eff[], key: string) =>
    sheetWith(effects).resources.find((r) => r.key === key);

  it("picks a pool the entry gives, and the sheet gives that pool's uses back", () => {
    const cards = renderCards([POOL, OTHER, { kind: 'resourceRegain', key: 'grit', amount: 1 }]);
    line('1 use of grit back on a short rest');
    expect(boxValue(`${T}: Pool`)).toBe('grit');
    expect(screen.queryByText(UNKNOWN)).toBeNull();
    change(`${T}: Uses back`, '2');
    expect(cards.written()[2]).toEqual({ kind: 'resourceRegain', key: 'grit', amount: 2 });
    noProblems(cards.written());
    expect(pool([POOL, OTHER], 'grit')?.regainOnShort).toBeUndefined();
    expect(pool(cards.written(), 'grit')?.regainOnShort).toBe(2);
    expect(pool(cards.written(), 'luck')?.regainOnShort).toBeUndefined();

    change(`${T}: Pool`, 'luck');
    expect(cards.written()[2]).toEqual({ kind: 'resourceRegain', key: 'luck', amount: 2 });
    line('2 uses of luck back on a short rest');
    expect(pool(cards.written(), 'grit')?.regainOnShort).toBeUndefined();
    expect(pool(cards.written(), 'luck')?.regainOnShort).toBe(2);

    cleanup();
    renderCards(cards.written());
    expect(boxValue(`${T}: Pool`)).toBe('luck');
    expect(boxValue(`${T}: Uses back`)).toBe('2');
  });

  it('keeps a key no pool here has, as written, and says it gives nothing alone', () => {
    const cards = renderCards([POOL, make(T)]);
    expect(boxValue(`${T}: Pool`)).toBe('uses');
    expect(screen.getByRole('option', { name: 'uses, as written' })).toBeTruthy();
    expect(screen.getByText(UNKNOWN)).toBeTruthy();
    noProblems(cards.written());
    // The reader takes it; the sheet has no such pool to give back to.
    expect(pool(cards.written(), 'uses')).toBeUndefined();
    expect(pool(cards.written(), 'grit')?.regainOnShort).toBeUndefined();
    change(`${T}: Pool`, 'grit');
    expect(screen.queryByText(UNKNOWN)).toBeNull();
    expect(screen.queryByRole('option', { name: 'uses, as written' })).toBeNull();
  });

  it('with no pool to pick, takes a key typed in', () => {
    const cards = renderCards([make(T)]);
    expect(screen.queryByLabelText(`${T}: Pool`)).toBeNull();
    change(`${T}: Pool's key`, 'grit');
    expect(cards.written()).toEqual([{ kind: 'resourceRegain', key: 'grit', amount: 1 }]);
    expect(screen.getByText(UNKNOWN)).toBeTruthy();
    // Beside another entry's Grit, it counts.
    expect(pool([...cards.written(), POOL], 'grit')?.regainOnShort).toBe(1);

    cleanup();
    renderCards(cards.written());
    expect(boxValue(`${T}: Pool's key`)).toBe('grit');
  });

  it("lists another entry's pools handed in, as a class's are", () => {
    renderCards([make(T)], { resources: [POOL] });
    expect(boxValue(`${T}: Pool`)).toBe('uses');
    expect(screen.getByRole('option', { name: 'Grit' })).toBeTruthy();
  });
});

describe('where the action cards are offered', () => {
  it('offers one more action in play, and uses back only on a build', () => {
    const inPlay = moreKinds({ inPlay: true, spells: false });
    expect(inPlay).toContain('One more action');
    expect(inPlay).not.toContain('Uses back on a short rest');
    expect(moreKinds({ inPlay: false, spells: false })).toEqual(
      expect.arrayContaining(['One more action', 'Uses back on a short rest']),
    );
  });
});
