import { describe, expect, it } from 'vitest';
import { AS_WRITTEN, guidanceVersion, readTableRules, TABLE_RULES } from './castGuidance';

describe('table rules', () => {
  it('takes the first value of each rule as written, in both editions', () => {
    for (const edition of ['2014', '2024'] as const) {
      for (const [id, values] of Object.entries(TABLE_RULES)) {
        expect(AS_WRITTEN[edition][id as keyof typeof TABLE_RULES]).toBe(values[0]);
      }
    }
  });

  it('reads known rules with known values, and says what else it found', () => {
    const read = readTableRules(
      JSON.parse(
        '{"restLength":"gritty","critDamage":"maxPlusRoll","flanking":"sometimes","encumbrance":"variant","__proto__":"x","oneUseDice":2}',
      ),
    );
    expect(read.rules).toEqual({ restLength: 'gritty', critDamage: 'maxPlusRoll' });
    expect(read.problems).toEqual([
      'table rules: flanking is one of off, advantage, plusTwo',
      'table rules: unknown rule "encumbrance"',
      'table rules: unknown rule "__proto__"',
      'table rules: oneUseDice is one of after, before',
    ]);
  });

  it('reads nothing from no rules, and says so for something that is not a set of rules', () => {
    expect(readTableRules(undefined)).toEqual({ rules: {}, problems: [] });
    expect(readTableRules(['gritty']).problems).toEqual(['table rules: not a list of rules']);
  });
});

describe('guidanceVersion', () => {
  it('takes a whole version up to the one this build reads', () => {
    expect(guidanceVersion({ v: 1 })).toEqual({ v: 1 });
    for (const v of [undefined, 0, 1.5, '1', -1]) {
      expect(guidanceVersion({ v })).toEqual({
        problem: 'its mechanics have no version, so they do not count',
      });
    }
    expect(guidanceVersion({ v: 2 })).toEqual({
      problem: 'made with a newer Cast Guidance: update to use its mechanics',
    });
    expect(guidanceVersion(JSON.parse('{"__proto__":{"v":1}}'))).toHaveProperty('problem');
  });
});
