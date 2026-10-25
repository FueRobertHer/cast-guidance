import { describe, expect, it } from 'vitest';
import { stripTrailingParenthetical } from './trailingParenthetical';

/** The regex this replaced, kept as the reference for what it should do. */
const legacy = (s: string) => s.replace(/\s*\(.*\)\s*$/, '');

describe('stripTrailingParenthetical', () => {
  it('does what the regex did', () => {
    for (const s of [
      'Sneak Attack (+1d6 once/turn)',
      'Extra Attack (2)',
      'Extra Attack',
      'Rage (3/long rest)  ',
      'Channel Divinity (2) (Turn Undead)',
      'A (b) c',
      'A (b) c)',
      'no close (here',
      '(only)',
      'nested (a (b) c)',
      'two lines (x\ny)',
      'two lines\n(y)',
      'line sep (x y)',
      'tab\t(x)\t',
      ')(',
      '',
      '   ',
    ]) {
      expect(stripTrailingParenthetical(s), JSON.stringify(s)).toBe(legacy(s));
    }
  });

  it('returns a string with no "(" untouched', () => {
    const s = 'Second Wind ';
    expect(stripTrailingParenthetical(s)).toBe(s);
  });

  it('stays linear on a name full of "("', () => {
    // About eleven seconds for the regex on a fast machine: it retried `.*`
    // from every "(". The budget here is the test timeout.
    const s = `${'('.repeat(120_000)}x`;
    expect(stripTrailingParenthetical(s)).toBe(s);
  }, 2000);
});
