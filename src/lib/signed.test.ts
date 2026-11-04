import { describe, expect, it } from 'vitest';
import { parseDice } from '@/dice/parse';
import { signed } from './signed';

describe('signed', () => {
  it('leads with a plus at zero and above', () => {
    expect(signed(3)).toBe('+3');
    expect(signed(0)).toBe('+0');
  });

  it('writes a negative with a true minus, not a hyphen', () => {
    expect(signed(-1)).toBe('−1');
  });

  it('is for reading only: the dice parser takes the hyphen, not the minus', () => {
    expect(parseDice('1d20-1')).toBeDefined();
    expect(() => parseDice(`1d20${signed(-1)}`)).toThrow();
  });
});
