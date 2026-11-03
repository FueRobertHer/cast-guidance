import { describe, expect, it } from 'vitest';
import { CONDITIONS, conditionEffect, conditionLimits } from './conditionEffects';

const ids = (list: string[]) => list.map((id) => ({ id }));

describe('conditionLimits', () => {
  it('is all-empty with no conditions', () => {
    expect(conditionLimits([])).toEqual({
      noActions: [],
      noVerbal: [],
      attackDisadvantage: [],
    });
  });

  it('Paralyzed stops actions and speech but is not an attack-disadvantage source', () => {
    const l = conditionLimits(ids(['Paralyzed']));
    expect(l.noActions).toEqual(['Paralyzed']);
    expect(l.noVerbal).toEqual(['Paralyzed']);
    expect(l.attackDisadvantage).toEqual([]);
  });

  it('Incapacitated stops actions only', () => {
    const l = conditionLimits(ids(['Incapacitated']));
    expect(l.noActions).toEqual(['Incapacitated']);
    expect(l.noVerbal).toEqual([]);
  });

  it('Blinded/Prone give attack disadvantage without blocking actions', () => {
    const l = conditionLimits(ids(['Blinded', 'Prone']));
    expect(l.attackDisadvantage).toEqual(['Blinded', 'Prone']);
    expect(l.noActions).toEqual([]);
  });

  it('accumulates every responsible condition across categories', () => {
    const l = conditionLimits(ids(['Stunned', 'Poisoned']));
    expect(l.noActions).toEqual(['Stunned']);
    expect(l.noVerbal).toEqual(['Stunned']);
    expect(l.attackDisadvantage).toEqual(['Poisoned']);
  });
});

describe('conditionEffect', () => {
  it('has a line for every condition the picker offers, in both editions', () => {
    for (const id of CONDITIONS) {
      expect(conditionEffect(id, '2014'), `${id} 2014`).toMatch(/\.$/);
      expect(conditionEffect(id, '2024'), `${id} 2024`).toMatch(/\.$/);
    }
  });

  it('gives each edition its own line where the rules differ', () => {
    expect(conditionEffect('Grappled', '2014')).toBe('Your speed is 0.');
    expect(conditionEffect('Grappled', '2024')).toMatch(
      /disadvantage on attack rolls against anyone but the grappler/,
    );
    expect(conditionEffect('Incapacitated', '2024')).toMatch(/disadvantage on initiative/);
    expect(conditionEffect('Incapacitated', '2014')).not.toMatch(/initiative/);
    // Both editions end concentration, 2014 by its concentration rule.
    expect(conditionEffect('Incapacitated', '2014')).toMatch(/concentration breaks/);
  });

  it('gives both editions the same line where they agree', () => {
    expect(conditionEffect('Poisoned', '2014')).toBe(
      'Disadvantage on attack rolls and ability checks.',
    );
    expect(conditionEffect('Poisoned', '2024')).toBe(conditionEffect('Poisoned', '2014'));
  });

  it('has nothing for a condition it does not know, and leaves Exhaustion to its level', () => {
    expect(conditionEffect('Hexed', '2024')).toBeUndefined();
    expect(conditionEffect('Exhaustion', '2024')).toBeUndefined();
  });
});
