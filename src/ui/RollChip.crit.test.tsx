// @vitest-environment jsdom
// A damage chip that goes with an attack rolls its dice twice when that
// attack crit, and only then: another character's crit, another attack's, or
// a chip that is no damage chip leaves the dice as they are.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DiceRollDetail, RollResult } from '@/dice/types';
import { cancelHeld } from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import { RollChip } from './RollChip';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  cancelHeld();
  rollLogStore.setState({ rolls: [], seq: 0 });
});

/** Every die the next rolls show is a 4. */
const fours = () =>
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((buf) => {
    if (buf instanceof Uint32Array) buf[0] = 3;
    return buf;
  });

/** A crit Longsword attack by `by`, landed. */
const crit = (by: string) => {
  const swing: RollResult = {
    expr: '1d20+5',
    label: 'Longsword attack',
    kind: 'd20',
    total: 25,
    at: 0,
    terms: [
      { kind: 'dice', sign: 1, sides: 20, rolls: [{ v: 20, kept: true }] },
      { kind: 'mod', value: 5 },
    ],
    meta: { d20: { natural: 20 }, attack: { by, of: 'Longsword', crit: true } },
  };
  rollLogStore.getState().append(swing);
};

/** How many dice the newest roll rolled. */
const diceRolled = () =>
  (rollLogStore.getState().rolls[0]?.terms ?? [])
    .filter((t): t is DiceRollDetail => t.kind === 'dice')
    .reduce((n, t) => n + t.rolls.length, 0);

it("doubles only the crit's own character's damage", () => {
  fours();
  render(
    <RollChip
      expr="1d8+3"
      label="Longsword slashing damage"
      variant="damage"
      withAttack={{ by: 'c1', of: 'Longsword' }}
    />,
  );
  crit('c2');
  fireEvent.click(screen.getByRole('button'));
  expect(diceRolled()).toBe(1);
  crit('c1');
  fireEvent.click(screen.getByRole('button'));
  expect(diceRolled()).toBe(2);
  expect(rollLogStore.getState().rolls[0]?.total).toBe(11);
});

it("leaves another attack's damage alone, and a chip that deals none", () => {
  fours();
  render(
    <>
      <RollChip
        expr="1d6"
        label="Shortbow piercing damage"
        variant="damage"
        withAttack={{ by: 'c1', of: 'Shortbow' }}
      />
      <RollChip expr="2d4" label="Bonus die" variant="dice" withAttack={{ by: 'c1' }} />
    </>,
  );
  crit('c1');
  fireEvent.click(screen.getByTitle('Shortbow piercing damage'));
  expect(diceRolled()).toBe(1);
  crit('c1');
  fireEvent.click(screen.getByTitle('Bonus die'));
  expect(diceRolled()).toBe(2);
});
