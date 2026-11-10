import { describe, expect, it } from 'vitest';
import { CAST_GUIDANCE_LIMITS, type FormulaName, formulaNamesFor } from './castGuidance';
import { Formula, parseFormula, readAmount } from './formula';
import type { FormulaScope } from './types';

const ALL = formulaNamesFor('acBonus').names;

const scope: FormulaScope = {
  level: 7,
  classLevel: 5,
  prof: 3,
  hp: 20,
  maxHp: 45,
  mod: { str: 3, dex: 2, con: 1, int: 0, wis: -1, cha: 4 },
  score: { str: 16, dex: 14, con: 12, int: 10, wis: 8, cha: 18 },
};

function value(text: string, s: FormulaScope = scope): number {
  const f = parseFormula(text, ALL);
  if (!(f instanceof Formula)) throw new Error(f.problem);
  return f.evaluate(s);
}

function problem(text: string, allowed: ReadonlySet<FormulaName> = ALL, why?: string): string {
  const f = parseFormula(text, allowed, why);
  if (f instanceof Formula) throw new Error(`"${text}" parsed`);
  return f.problem;
}

describe('formula evaluation', () => {
  it.each([
    ['max(1, mod.cha)', 4],
    ['max(1, mod.wis)', 1],
    ['ceil(classLevel / 2)', 3],
    ['classLevel / 2', 2],
    ['floor(level / 3) + prof', 5],
    ['hp <= maxHp / 2 ? 1 : 0', 1],
    ['hp > maxHp / 2 ? 1 : 0', 0],
    ['min(score.str, score.dex, 15)', 14],
    ['-mod.wis', 1],
    ['!0 + !5', 1],
    ['2 + 3 * 4', 14],
    ['(2 + 3) * 4', 20],
    ['10 - 4 - 3', 3],
    ['level >= 5 && level < 11 ? 2 : level >= 11 ? 3 : 1', 2],
    ['0 || prof', 3],
    ['0 && prof', 0],
    ['mod.str === 3', 1],
    ['mod.str !== 3', 0],
    ['1.5 * 3', 4],
  ])('%s is %d', (text, expected) => {
    expect(value(text)).toBe(expected);
  });

  it('gives 0 for dividing by zero, anywhere in the formula', () => {
    expect(value('5 / 0')).toBe(0);
    expect(value('prof + level / (classLevel - 5)')).toBe(3);
  });

  it('rounds a fraction left at the end down, negative ones too', () => {
    expect(value('7 / 2')).toBe(3);
    expect(value('-7 / 2')).toBe(-4);
  });

  it('holds the result within the amount limit', () => {
    const big = '99999 * 99999 * 99999';
    expect(value(big)).toBe(CAST_GUIDANCE_LIMITS.amountLimit);
    expect(value(`-${big}`)).toBe(-CAST_GUIDANCE_LIMITS.amountLimit);
  });

  it('reads what the scope holds when it is worked out, not when parsed', () => {
    const f = parseFormula('prof + classLevel', ALL) as Formula;
    expect(f.evaluate(scope)).toBe(8);
    expect(f.evaluate({ ...scope, prof: 6, classLevel: 20 })).toBe(26);
  });

  it('counts its steps for the per-derive budget', () => {
    expect((parseFormula('1', ALL) as Formula).cost).toBe(1);
    expect((parseFormula('max(1, mod.cha) + 2', ALL) as Formula).cost).toBe(5);
  });

  it('works out the same number JavaScript does, rounded down, wherever it divides by anything else', () => {
    const exprs = [
      'max(1, mod.cha) + prof * 2',
      'ceil(classLevel / 3) - floor(level / 4)',
      'hp <= maxHp / 2 && level > 4 ? prof : -1',
      '!(mod.dex > 2) || score.int == 10',
      'min(10, 3 + level * 2) / 3',
      '(level - classLevel) * (prof + 1) - mod.wis',
    ];
    const names = 'level, classLevel, prof, hp, maxHp, mod, score, min, max, floor, ceil';
    for (const text of exprs) {
      // Tests only: the app itself never builds a function from text.
      const js = new Function(names, `return (${text});`) as (...a: unknown[]) => number;
      const jsValue = Number(
        js(
          scope.level,
          scope.classLevel,
          scope.prof,
          scope.hp,
          scope.maxHp,
          scope.mod,
          scope.score,
          Math.min,
          Math.max,
          Math.floor,
          Math.ceil,
        ),
      );
      expect(value(text), text).toBe(Math.floor(jsValue));
    }
  });
});

describe('formula limits and problems', () => {
  it('refuses anything that is not part of the language', () => {
    expect(problem('mod.cha; alert(1)')).toMatch(/";" is not part/);
    expect(problem('constructor')).toMatch(/not a name/);
    expect(problem('__proto__')).toMatch(/not a name/);
    expect(problem('Math.max(1, 2)')).toMatch(/not a name/);
    expect(problem('mod.luck')).toMatch(/not a name/);
    expect(problem('level = 3')).toMatch(/"=" is not part/);
    expect(problem('2 ** 3')).toMatch(/"\*" was not expected/);
    expect(problem('--level')).toMatch(/"--" is not part/);
    expect(problem('+level')).toMatch(/"\+" was not expected/);
    expect(problem('"text"')).toMatch(/is not part/);
    expect(problem('`x`')).toMatch(/is not part/);
  });

  it('says what is missing or out of place', () => {
    expect(problem('(1 + 2')).toMatch(/"\)" is missing/);
    expect(problem('1 +')).toMatch(/ends too soon/);
    expect(problem('1 2')).toMatch(/"2" was not expected/);
    expect(problem('prof ? 1')).toMatch(/":" is missing/);
    expect(problem('floor(1, 2)')).toMatch(/floor takes one number/);
    expect(problem('max()')).toMatch(/max needs at least one number/);
    expect(problem('   ')).toMatch(/empty/);
  });

  it('is at most 200 characters', () => {
    const long = `1${' + 1'.repeat(50)}`;
    expect(long.length).toBeGreaterThan(200);
    expect(problem(long)).toMatch(/at most 200 characters/);
  });

  it('is at most 32 levels deep', () => {
    expect(value(`${'('.repeat(60)}1${')'.repeat(60)}`)).toBe(1);
    expect(problem(`${'-'.repeat(1)}${'!'.repeat(40)}1`)).toMatch(/at most 32 levels deep/);
    expect(problem(`${'max('.repeat(33)}1${')'.repeat(33)}`)).toMatch(/at most 32 levels deep/);
    expect(value(`${'max('.repeat(31)}1${')'.repeat(31)}`)).toBe(1);
  });

  it('reads only the names its kind allows, and says why', () => {
    const { names, why } = formulaNamesFor('abilityBonus');
    expect(problem('mod.cha', names, why)).toMatch(
      /"mod.cha" cannot be read here: it changes the ability scores/,
    );
    expect(parseFormula('ceil(level / 4) + prof', names, why)).toBeInstanceOf(Formula);
    const hp = formulaNamesFor('maxHpBonus');
    expect(problem('maxHp / 2', hp.names, hp.why)).toMatch(/cannot read hp or maxHp/);
    expect(parseFormula('mod.con * level', hp.names, hp.why)).toBeInstanceOf(Formula);
  });
});

describe('stored amounts', () => {
  it('keeps a plain number as it is', () => {
    expect(readAmount(3, ALL)).toEqual({ value: 3 });
    expect(readAmount(-2, ALL)).toEqual({ value: -2 });
  });

  it('parses a formula once, for fold time', () => {
    const read = readAmount({ f: 'max(1, mod.cha)' }, ALL);
    expect('formula' in read && read.formula.evaluate(scope)).toBe(4);
  });

  it('reads a level table by class level: the highest level reached, 0 below the first', () => {
    const read = readAmount({ byLevel: { '9': 3, '1': 2, '16': 4 } }, ALL);
    if (!('formula' in read)) throw new Error('no table');
    const at = (classLevel: number) => read.formula.evaluate({ ...scope, classLevel });
    expect([at(1), at(8), at(9), at(15), at(16), at(20)]).toEqual([2, 2, 3, 3, 4, 4]);
    const late = readAmount({ byLevel: { '3': 1 } }, ALL);
    expect('formula' in late && late.formula.evaluate({ ...scope, classLevel: 2 })).toBe(0);
  });

  it('says what is wrong with a bad amount', () => {
    const bad = (raw: unknown) => {
      const read = readAmount(raw, ALL);
      return 'problem' in read ? read.problem : 'read';
    };
    expect(bad('3')).toMatch(/needs a number, a formula/);
    expect(bad(Number.NaN)).toMatch(/needs a number/);
    expect(bad(Number.POSITIVE_INFINITY)).toMatch(/needs a number/);
    expect(bad(10_000_000)).toMatch(/too large/);
    expect(bad({ f: 3 })).toMatch(/needs a number, a formula/);
    expect(bad({ byLevel: {} })).toMatch(/at least one level/);
    expect(bad({ byLevel: { first: 1 } })).toMatch(/"first" is not a level/);
    expect(bad({ byLevel: { '1': 'two' } })).toMatch(/level 1 needs a number/);
    expect(
      bad({ byLevel: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(i), i])) }),
    ).toMatch(/at most 30 levels/);
    expect(bad(JSON.parse('{"__proto__": {"f": "1"}}'))).toMatch(/needs a number, a formula/);
  });

  it('reads a hostile formula in bounded time', () => {
    const started = performance.now();
    for (let i = 0; i < 2_000; i++) {
      parseFormula('('.repeat(100) + ')'.repeat(100), ALL);
      parseFormula(`${'1+'.repeat(99)}1`, ALL);
      parseFormula('x'.repeat(1_000_000), ALL);
    }
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
