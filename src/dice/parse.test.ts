import { describe, expect, it } from 'vitest';
import { parseDice } from './parse';
import { DiceSyntaxError } from './types';

describe('parseDice', () => {
  it('parses a simple die', () => {
    expect(parseDice('1d20').terms).toEqual([{ kind: 'dice', sign: 1, count: 1, sides: 20 }]);
  });

  it('defaults count to 1', () => {
    expect(parseDice('d8').terms).toEqual([{ kind: 'dice', sign: 1, count: 1, sides: 8 }]);
  });

  it('parses dice plus modifier', () => {
    expect(parseDice('2d6+3').terms).toEqual([
      { kind: 'dice', sign: 1, count: 2, sides: 6 },
      { kind: 'mod', sign: 1, value: 3 },
    ]);
  });

  it('parses multi-term expressions with whitespace', () => {
    expect(parseDice('1d8 + 2 + 1d6 - 1').terms).toEqual([
      { kind: 'dice', sign: 1, count: 1, sides: 8 },
      { kind: 'mod', sign: 1, value: 2 },
      { kind: 'dice', sign: 1, count: 1, sides: 6 },
      { kind: 'mod', sign: -1, value: 1 },
    ]);
  });

  it('parses negative leading terms', () => {
    expect(parseDice('-1d4+5').terms).toEqual([
      { kind: 'dice', sign: -1, count: 1, sides: 4 },
      { kind: 'mod', sign: 1, value: 5 },
    ]);
  });

  it('parses keep-highest', () => {
    expect(parseDice('2d20kh1').terms).toEqual([
      { kind: 'dice', sign: 1, count: 2, sides: 20, keep: { mode: 'kh', n: 1 } },
    ]);
  });

  it('defaults keep count to 1', () => {
    expect(parseDice('2d20kh').terms[0]).toMatchObject({ keep: { mode: 'kh', n: 1 } });
  });

  it('parses drop-lowest (ability score rolls)', () => {
    expect(parseDice('4d6dl1').terms).toEqual([
      { kind: 'dice', sign: 1, count: 4, sides: 6, keep: { mode: 'dl', n: 1 } },
    ]);
  });

  it('parses kl and dh', () => {
    expect(parseDice('2d20kl1').terms[0]).toMatchObject({ keep: { mode: 'kl', n: 1 } });
    expect(parseDice('3d6dh1').terms[0]).toMatchObject({ keep: { mode: 'dh', n: 1 } });
  });

  it('is case-insensitive', () => {
    expect(parseDice('2D20KH1').terms[0]).toMatchObject({
      count: 2,
      sides: 20,
      keep: { mode: 'kh', n: 1 },
    });
  });

  it('parses a flat number', () => {
    expect(parseDice('5').terms).toEqual([{ kind: 'mod', sign: 1, value: 5 }]);
  });

  it('parses constant and dice multiplication factors', () => {
    expect(parseDice('1d4×10')).toEqual({
      expr: '1d4×10',
      terms: [{ kind: 'dice', sign: 1, count: 1, sides: 4 }],
      multiplier: { kind: 'mod', sign: 1, value: 10 },
    });
    expect(parseDice('1d10 * 1d10').multiplier).toEqual({
      kind: 'dice',
      sign: 1,
      count: 1,
      sides: 10,
    });
  });

  const bad: Array<[string, string]> = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['1d', 'expected die sides'],
    ['d', 'expected die sides'],
    ['2d6+', 'ends after operator'],
    ['2d6 3', 'unexpected'],
    ['0d6', 'at least 1'],
    ['1d1', 'at least 2 sides'],
    ['1d0', 'at least 2 sides'],
    ['101d6', 'count above'],
    ['1d10001', 'sides above'],
    ['2d20kh3', 'keep more'],
    ['2d20dl2', 'drop all'],
    ['2d6k3', 'expected kh or kl'],
    ['foo', 'expected a number or die'],
    ['1d20+bar', 'expected a number or die'],
    ['1d6×', 'ends after multiplier'],
    ['1d6×2+1', 'unexpected.*after multiplier'],
  ];
  for (const [expr, msg] of bad) {
    it(`rejects "${expr}"`, () => {
      expect(() => parseDice(expr)).toThrowError(DiceSyntaxError);
      expect(() => parseDice(expr)).toThrowError(new RegExp(msg, 'i'));
    });
  }

  it('rejects too many terms', () => {
    const expr = Array.from({ length: 21 }, () => '1d6').join('+');
    expect(() => parseDice(expr)).toThrowError(/more than 20 terms/i);
  });
});
