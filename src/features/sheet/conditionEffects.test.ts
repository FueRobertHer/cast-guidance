import { describe, expect, it } from 'vitest';
import { conditionLimits } from './conditionEffects';

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
