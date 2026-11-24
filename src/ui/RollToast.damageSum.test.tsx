// @vitest-environment jsdom
// Damage that rolls apart by type (Divine Smite's radiant, a coating's poison)
// heads its toast with what it comes to before resistances, in the large
// number, and every part, the weapon's first, is a row under it. Under the
// attack it went with, the damage total is as large as the attack's. A crit
// is said once, at the total. A screen reader hears the total before the parts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RollResult } from '@/dice/types';
import { getAnnouncerState, resetAnnouncer, THROTTLE_MS } from '@/stores/announcer';
import { followUpStore } from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import { damageHeadline, RollToast, toastAnnouncement } from './RollToast';

const spoken = () => getAnnouncerState().messages.map((m) => m.text);

/** A damage roll of `faces` on d`sides`, plus `mod`. */
function dealt(
  id: string,
  label: string,
  sides: number,
  faces: number[],
  mod = 0,
  meta: RollResult['meta'] = {},
): RollResult {
  const sum = faces.reduce((n, v) => n + v, 0) + mod;
  return {
    id,
    expr: `${String(faces.length)}d${String(sides)}${mod === 0 ? '' : `+${String(mod)}`}`,
    label,
    kind: 'damage',
    total: sum,
    at: 0,
    terms: [
      { kind: 'dice', sign: 1, sides, rolls: faces.map((v) => ({ v, kept: true })) },
      ...(mod === 0 ? [] : [{ kind: 'mod' as const, value: mod }]),
    ],
    meta,
  };
}

const swing: RollResult = {
  id: 'a1',
  expr: '1d20+5',
  label: 'Longsword attack',
  kind: 'd20',
  total: 17,
  at: 0,
  terms: [
    { kind: 'dice', sign: 1, sides: 20, rolls: [{ v: 12, kept: true }] },
    { kind: 'mod', value: 5 },
  ],
  meta: { d20: { natural: 12 }, attack: { by: 'c1', of: 'Longsword', crit: false } },
};

const slashing = (meta: RollResult['meta'] = {}) =>
  dealt('w1', 'Longsword slashing damage', 8, [6], 3, meta);
const radiant = (meta: RollResult['meta'] = {}) =>
  dealt('s1', 'Divine Smite radiant damage', 8, [5, 7], 0, meta);
const poison = (meta: RollResult['meta'] = {}) =>
  dealt('p1', 'Basic Poison poison damage', 4, [3], 0, meta);

/** Lands the rolls as one: a roll after the first goes with `lead`. */
function land(lead: RollResult, ...joined: RollResult[]) {
  act(() => {
    rollLogStore.getState().append(lead);
    for (const r of joined) {
      rollLogStore.getState().append({ ...r, meta: { ...r.meta, withRoll: lead.id } });
    }
  });
}

/** The toast: a group once rows show under its headline, else its one row. */
const toast = () =>
  screen.queryByRole('group', { name: 'Roll result' }) ??
  screen.getByText(/attack|damage/).closest('div.fixed');
/** The toast's large numbers, in order. */
const headlines = () =>
  [...(toast()?.querySelectorAll('.text-stat') ?? [])].map((e) => e.textContent);
/** Its rows' numbers, in the smaller size, in order. */
const parts = () =>
  [...(toast()?.querySelectorAll('.text-title-sheet') ?? [])].map((e) => e.textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  resetAnnouncer();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetAnnouncer();
  rollLogStore.setState({ rolls: [], seq: 0 });
  followUpStore.setState({ offer: null, next: null, reroll: null });
});

describe('damage rolled alone', () => {
  it('shows one type as it always has: its own total, its dice, no rows', () => {
    render(<RollToast />);
    land(slashing());
    expect(screen.getByText('Longsword slashing damage')).toBeTruthy();
    expect(headlines()).toEqual(['9']);
    expect(parts()).toEqual([]);
    expect(screen.queryByText('Before resistances')).toBeNull();
    expect(spoken()).toEqual(['Longsword slashing damage: 9. Rolled 6, plus 3']);
  });

  it('heads with the total in parts, and every part, the weapon first, is a row', () => {
    render(<RollToast />);
    land(slashing(), radiant(), poison());
    expect(screen.getByText('Longsword damage')).toBeTruthy();
    expect(screen.getByText('Before resistances')).toBeTruthy();
    expect(headlines()).toEqual(['24']);
    expect(parts()).toEqual(['9', '12', '3']);
    expect(screen.getByText(/^Longsword slashing damage:/)).toBeTruthy();
    expect(screen.getByText(/^Divine Smite radiant damage:/)).toBeTruthy();
    expect(screen.getByText(/^Basic Poison poison damage:/)).toBeTruthy();
    expect(screen.queryByText('Total before resistances')).toBeNull();
    expect(spoken()).toEqual([
      'Longsword damage: 24 before resistances. Longsword slashing damage: 9. Rolled 6, plus 3. ' +
        'Divine Smite radiant damage: 12. Rolled 5, 7. Basic Poison poison damage: 3. Rolled 3',
    ]);
  });

  it('says a crit once, at the total, when every part doubled', () => {
    render(<RollToast />);
    land(slashing({ critical: true }), radiant({ critical: true }));
    expect(screen.getAllByText('Critical')).toHaveLength(1);
    expect(screen.queryByText(/, critical:/)).toBeNull();
  });

  it('marks the parts that doubled when one did not (the player’s own, set not to)', () => {
    render(<RollToast />);
    land(slashing({ critical: true }), poison());
    expect(screen.getAllByText('Critical')).toHaveLength(1);
    expect(screen.getByText(/^Longsword slashing damage, critical:/)).toBeTruthy();
    expect(screen.getByText(/^Basic Poison poison damage:/)).toBeTruthy();
  });

  it('lands the total again when Savage Attacker rerolls the weapon’s part, and says it first', () => {
    render(<RollToast />);
    const weapon = slashing();
    followUpStore.setState({
      reroll: {
        id: 'w1',
        target: 'w1',
        source: 'Savage Attacker',
        terms: 2,
        total: 9,
        weapon: () => dealt('x', 'Longsword slashing damage', 8, [8], 3),
        pay: () => {},
      },
    });
    land(weapon, poison());
    expect(headlines()).toEqual(['12']);
    fireEvent.click(screen.getByRole('button', { name: /^Reroll the weapon's dice/ }));
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    expect(headlines()).toEqual(['14']);
    expect(parts()).toEqual(['11', '3']);
    expect(screen.getByText('Savage Attacker: rolled 9, then 11, kept 11')).toBeTruthy();
    expect(spoken().at(-1)).toBe(
      'Savage Attacker: rolled 9, then 11, kept 11. Longsword damage: 14 before resistances. ' +
        'Longsword slashing damage: 11. Rolled 8, plus 3. Savage Attacker: rolled 9, then 11, kept 11',
    );
  });
});

describe('damage under its attack', () => {
  it('shows one damage roll as it always has: a row under the attack', () => {
    render(<RollToast />);
    land(swing, slashing());
    expect(headlines()).toEqual(['17']);
    expect(parts()).toEqual(['9']);
    expect(screen.queryByText('Before resistances')).toBeNull();
  });

  it('heads the damage rows with their total, as large as the attack’s', () => {
    render(<RollToast />);
    land(swing, slashing(), radiant(), poison());
    expect(headlines()).toEqual(['17', '24']);
    expect(parts()).toEqual(['9', '12', '3']);
    expect(screen.getByText('Longsword damage')).toBeTruthy();
    expect(screen.getByText('Before resistances')).toBeTruthy();
    expect(spoken()).toEqual([
      'Longsword attack: 17. Rolled 12, plus 5. Longsword damage: 24 before resistances. ' +
        'Longsword slashing damage: 9. Rolled 6, plus 3. Divine Smite radiant damage: 12. Rolled 5, 7. ' +
        'Basic Poison poison damage: 3. Rolled 3',
    ]);
  });
});

describe('damageHeadline', () => {
  it('names the damage its first part leads, without that part’s type', () => {
    expect(damageHeadline(slashing())).toBe('Longsword damage');
    expect(damageHeadline({ ...slashing(), label: 'Ice Storm Bludgeoning damage' })).toBe(
      'Ice Storm damage',
    );
  });

  it('keeps a label with no type it knows as it is', () => {
    expect(damageHeadline({ ...slashing(), label: 'Longsword damage' })).toBe('Longsword damage');
    expect(damageHeadline({ ...slashing(), label: 'Shadow Blade' })).toBe('Shadow Blade');
  });
});

describe('toastAnnouncement', () => {
  it('says a heal under an attack as before, with no damage total for one damage roll', () => {
    const heal: RollResult = { ...dealt('h1', 'Life Drain healing', 6, [4]), kind: 'heal' };
    expect(toastAnnouncement(swing, [slashing(), heal])).toBe(
      'Longsword attack: 17. Rolled 12, plus 5. Longsword slashing damage: 9. Rolled 6, plus 3. ' +
        'Life Drain healing: 4. Rolled 4',
    );
  });
});
