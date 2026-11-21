// A roll's colour: what its kind says, else what its dice say.
import { describe, expect, it } from 'vitest';
import type { RollResult } from '@/dice/types';
import { ROLL_INK, rollTone } from './rollTone';

const plain = (over: Partial<RollResult> = {}): RollResult => ({
  expr: '1d8',
  total: 5,
  at: 0,
  terms: [{ kind: 'dice', sign: 1, sides: 8, rolls: [{ v: 5, kept: true }] }],
  ...over,
});

describe('rollTone', () => {
  it('reads dice with no kind as plain dice, in the roll blue, never as damage', () => {
    expect(rollTone(plain())).toBe('dice');
    expect(ROLL_INK.dice).toBe('text-roll');
  });

  it('keeps what a kind says', () => {
    expect(rollTone(plain({ kind: 'damage' }))).toBe('damage');
    expect(rollTone(plain({ kind: 'heal' }))).toBe('heal');
  });
});
