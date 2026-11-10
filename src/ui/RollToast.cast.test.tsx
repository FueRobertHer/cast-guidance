// @vitest-environment jsdom
// The roll prompt casting a spell (the rolls canvas, "Level at cast" A): the
// ways to cast as tiles by source, the note by Roll saying what the tile picked
// spends, and Roll (or Heal, or Cast) spending it as the dice at its level land.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { d20Ask } from '@/features/sheet/d20Tests';
import { resetAnnouncer } from '@/stores/announcer';
import {
  cancelHeld,
  cancelHeldCast,
  castFrom,
  followUpStore,
  type HeldCast,
  heldRollStore,
  refreshHeldCast,
  rollFrom,
  rollHeld,
} from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import { rollOffersStore } from '@/stores/rollOffers';
import { RollToast } from './RollToast';

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

/**
 * Cure Wounds with a 1st-level slot spent, a 2nd-level one left, and a Staff
 * of Healing's charges; `spent` records what each cast spent.
 */
function cureWounds(over: Partial<HeldCast> = {}) {
  const spent: Array<string | null> = [];
  const plan: HeldCast = {
    id: 'cure-row',
    spell: 'Cure Wounds',
    groups: [
      {
        title: 'Spell slots',
        tiles: [
          {
            id: 'slot-1',
            head: '1st',
            sub: '0 left',
            ok: false,
            aria: 'Level 1 slot, 0 left, cannot pay now',
          },
          { id: 'slot-2', head: '2nd', sub: '2 left', ok: true, aria: 'Level 2 slot, 2 left' },
        ],
      },
      {
        title: 'Staff of Healing',
        sub: '1 charge a level · 7 of 10 left',
        tiles: [
          {
            id: 'staff-1',
            head: '1st',
            sub: '1 charge',
            ok: true,
            aria: 'Level 1 from Staff of Healing, 1 charge',
          },
          {
            id: 'staff-2',
            head: '2nd',
            sub: '2 charges',
            ok: true,
            aria: 'Level 2 from Staff of Healing, 2 charges',
          },
        ],
      },
    ],
    picked: 'slot-2',
    note: (id) => `Spends ${String(id)}.`,
    dice: (id) => ({
      expr: id?.endsWith('1') === true ? '1d8+3' : '2d8+3',
      label: 'Cure Wounds healing',
      kind: 'heal',
    }),
    line: (id) => (id?.endsWith('1') === true ? '1st level: 1d8+3' : '2nd level: 2d8+3'),
    cast: (id) => {
      spent.push(id);
    },
    ...over,
  };
  return { plan, spent };
}

const control = (name: string) => {
  const b = document.createElement('button');
  b.textContent = name;
  document.body.appendChild(b);
  return b;
};
const tile = (name: string) => screen.getByRole('button', { name });
const pressed = (name: string) => tile(name).getAttribute('aria-pressed') === 'true';
const rolls = () => rollLogStore.getState().rolls;

beforeEach(() => {
  resetAnnouncer();
});

afterEach(() => {
  cleanup();
  act(() => cancelHeld());
  vi.restoreAllMocks();
  resetAnnouncer();
  rollLogStore.setState({ rolls: [], seq: 0 });
  followUpStore.setState({ offer: null });
  document.body.replaceChildren();
});

describe('the roll prompt casting a spell', () => {
  it('shows every way to cast as tiles by source, on the one it starts on', () => {
    render(<RollToast />);
    const { plan } = cureWounds();
    act(() =>
      castFrom(control('2d8+3'), plan, undefined, { face: { text: '2d8+3', tone: 'heal' } }),
    );

    const group = screen.getByRole('group', { name: 'Cast Cure Wounds, choose and heal' });
    expect(group.textContent).toContain('2nd level: 2d8+3');
    expect(group.textContent).toContain('Staff of Healing · 1 charge a level · 7 of 10 left');
    expect(screen.getByRole('group', { name: 'Spell slots' })).toBeTruthy();
    expect(pressed('Level 2 slot, 2 left')).toBe(true);
    expect(tile('Level 1 slot, 0 left, cannot pay now').getAttribute('aria-disabled')).toBe('true');
    expect(group.textContent).toContain('Spends slot-2.');
    // A cast with no d20 has no mode to pick, and nothing is rolled yet.
    expect(screen.queryByRole('button', { name: 'Advantage' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Heal' })).toBeTruthy();
    expect(rolls()).toEqual([]);
  });

  it('moves to the tile tapped, and not to one that cannot pay', () => {
    render(<RollToast />);
    const { plan } = cureWounds();
    act(() => castFrom(control('2d8+3'), plan));
    fireEvent.click(tile('Level 1 from Staff of Healing, 1 charge'));
    expect(pressed('Level 1 from Staff of Healing, 1 charge')).toBe(true);
    expect(pressed('Level 2 slot, 2 left')).toBe(false);
    expect(screen.getByText('Spends staff-1.')).toBeTruthy();
    expect(screen.getByText('1st level: 1d8+3')).toBeTruthy();

    fireEvent.click(tile('Level 1 slot, 0 left, cannot pay now'));
    expect(pressed('Level 1 from Staff of Healing, 1 charge')).toBe(true);
  });

  it('spends the tile picked as its dice land, at its level', () => {
    render(<RollToast />);
    const { plan, spent } = cureWounds();
    act(() => castFrom(control('2d8+3'), plan));
    fireEvent.click(tile('Level 1 from Staff of Healing, 1 charge'));
    nextFaces(5);
    fireEvent.click(screen.getByRole('button', { name: 'Heal' }));

    expect(rolls()).toHaveLength(1);
    expect(rolls()[0]).toMatchObject({ expr: '1d8+3', kind: 'heal', total: 8 });
    expect(spent).toEqual(['staff-1']);
    expect(heldRollStore.getState().held).toBeNull();
  });

  it('casts when its control is tapped again, on the tile it is on', () => {
    const { plan, spent } = cureWounds();
    const from = control('2d8+3');
    castFrom(from, plan);
    nextFaces(4, 4);
    castFrom(from, plan);
    expect(rolls()[0]).toMatchObject({ expr: '2d8+3', total: 11 });
    expect(spent).toEqual(['slot-2']);
  });

  it('spends nothing when cancelled', () => {
    render(<RollToast />);
    const { plan, spent } = cureWounds();
    act(() => castFrom(control('2d8+3'), plan));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this cast' }));
    expect(spent).toEqual([]);
    expect(rolls()).toEqual([]);
    expect(heldRollStore.getState().held).toBeNull();
  });

  it('casts a spell with no dice from Cast, rolling nothing', () => {
    render(<RollToast />);
    const { plan, spent } = cureWounds({
      spell: 'Bless',
      dice: () => undefined,
      line: () => '2nd level',
    });
    act(() =>
      castFrom(control('Bless row'), plan, undefined, { face: { text: 'Cast', tone: 'cast' } }),
    );
    expect(screen.getByRole('group', { name: 'Cast Bless, choose and cast' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cast' }));
    expect(spent).toEqual(['slot-2']);
    expect(rolls()).toEqual([]);
  });

  it('rides on a spell attack, and offers the damage at the level picked after the hit', () => {
    render(<RollToast />);
    const { plan, spent } = cureWounds({
      spell: 'Ray Lance',
      dice: (id) => ({
        expr: id === 'slot-2' ? '2d10' : '1d10',
        label: 'Ray Lance fire damage',
        kind: 'damage',
      }),
      line: (id) => (id === 'slot-2' ? '2nd level, then 2d10' : '1st level, then 1d10'),
    });
    const ask = () =>
      d20Ask('1d20+5', {
        label: 'Ray Lance spell attack',
        riders: { dice: [], offers: [], advantage: [], disadvantage: [] },
        settlesOnNatural: true,
        attack: { by: 'c1', of: 'Ray Lance' },
      });
    act(() => rollFrom(control('+5'), ask, undefined, { cast: plan }));
    const group = screen.getByRole('group', { name: 'Ray Lance spell attack, choose and roll' });
    expect(group.textContent).toContain('d20 +5, 2nd level, then 2d10');
    expect(screen.getByRole('button', { name: 'Advantage' })).toBeTruthy();

    nextFaces(20);
    fireEvent.click(screen.getByRole('button', { name: 'Roll' }));
    expect(spent).toEqual(['slot-2']);
    expect(followUpStore.getState().offer?.expr).toBe('4d10');
  });

  it("makes each damage of the spell tapped while its attack waits at the level picked, by that damage's own dice", () => {
    const { plan } = cureWounds({
      spell: 'Ice Knife',
      dice: (id, label) => {
        const two = id === 'slot-2';
        return label === 'Ice Knife cold damage'
          ? { expr: two ? '3d6' : '2d6', label, kind: 'damage' }
          : { expr: '1d10', label: 'Ice Knife piercing damage', kind: 'damage' };
      },
    });
    const ask = () =>
      d20Ask('1d20+5', {
        label: 'Ice Knife spell attack',
        riders: { dice: [], offers: [], advantage: [], disadvantage: [] },
        settlesOnNatural: true,
        attack: { by: 'c1', of: 'Ice Knife' },
      });
    rollFrom(control('+5'), ask, undefined, { cast: plan });
    rollFrom(
      control('2d6 cold'),
      () => {
        throw new Error('the chip made its own dice, not the level picked');
      },
      undefined,
      { joins: { label: 'Ice Knife cold damage', of: 'Ice Knife' } },
    );
    nextFaces(10, 1, 1, 1);
    rollHeld();
    expect(rolls().map((r) => `${r.label ?? ''} ${r.expr}`)).toEqual([
      'Ice Knife cold damage 3d6',
      'Ice Knife spell attack 1d20+5',
    ]);
  });

  it('still says what happens to one-use dice left out of a spell attack', () => {
    render(<RollToast />);
    rollOffersStore.setState({ before: true });
    const { plan } = cureWounds({ note: () => 'Spends a 2nd-level slot.' });
    const ask = () =>
      d20Ask('1d20+5', {
        label: 'Ray Lance spell attack',
        riders: {
          dice: [],
          offers: [{ dice: '1d6', source: 'Bardic Inspiration', once: true, ifFailed: false }],
          advantage: [],
          disadvantage: [],
        },
        settlesOnNatural: true,
        attack: { by: 'c1', of: 'Ray Lance' },
      });
    act(() => rollFrom(control('+5'), ask, undefined, { cast: plan }));
    expect(
      screen.getByText('Spends a 2nd-level slot. Dice you leave are gone once the d20 shows.'),
    ).toBeTruthy();
    rollOffersStore.setState({ before: false });
  });
});

describe('a cast refreshed while it waits', () => {
  it('keeps the pick while it can pay, with the counts as they are now', () => {
    const { plan } = cureWounds();
    castFrom(control('2d8+3'), plan);
    refreshHeldCast('cure-row', () => ({
      ...plan,
      groups: plan.groups.map((g) => ({
        ...g,
        tiles: g.tiles.map((t) => (t.id === 'slot-2' ? { ...t, sub: '1 left' } : t)),
      })),
    }));
    const held = heldRollStore.getState().held;
    expect(held?.picked).toBe('slot-2');
    expect(held?.cast?.groups[0]?.tiles[1]?.sub).toBe('1 left');
  });

  it('goes back to where the cast starts once the pick cannot pay', () => {
    const { plan } = cureWounds();
    castFrom(control('2d8+3'), plan);
    heldRollStore.setState((s) => ({ held: s.held && { ...s.held, picked: 'staff-2' } }));
    refreshHeldCast('cure-row', () => ({
      ...plan,
      groups: plan.groups.map((g) => ({
        ...g,
        tiles: g.tiles.map((t) => (t.id === 'staff-2' ? { ...t, ok: false } : t)),
      })),
    }));
    expect(heldRollStore.getState().held?.picked).toBe('slot-2');
  });

  it('leaves a cast from another row alone', () => {
    const { plan } = cureWounds();
    castFrom(control('2d8+3'), plan);
    const other = vi.fn(() => plan);
    refreshHeldCast('another-row', other);
    expect(other).not.toHaveBeenCalled();
  });

  it('moves a start tile nobody chose to where the cast starts now, once a slot comes back', () => {
    // No slot left, so the cast starts on the staff's charges.
    const { plan } = cureWounds({ picked: 'staff-1' });
    castFrom(control('2d8+3'), plan);
    refreshHeldCast('cure-row', () => ({ ...plan, picked: 'slot-2' }));
    expect(heldRollStore.getState().held?.picked).toBe('slot-2');
  });

  it("lets the row's cast go, and no other", () => {
    const { plan } = cureWounds();
    castFrom(control('2d8+3'), plan);
    cancelHeldCast('another-row');
    expect(heldRollStore.getState().held).not.toBeNull();
    cancelHeldCast('cure-row');
    expect(heldRollStore.getState().held).toBeNull();
  });
});
