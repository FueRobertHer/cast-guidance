// The damage-type dropdowns show a default before they are touched. These
// rules are what stops that default from being a label the form shows and the
// saved file disagrees with: a weapon that read "slashing" in the builder and
// came out untyped, and a rider that read "fire" and burned nothing.
import { describe, expect, it } from 'vitest';
import { DEFAULT_RIDER_TYPE, damagePatch, defaultDamageType, nextRiders } from './itemFields';

describe('defaultDamageType', () => {
  it('cuts in melee and punctures at range', () => {
    expect(defaultDamageType('M')).toBe('S');
    expect(defaultDamageType('R')).toBe('P');
  });
});

describe('damagePatch', () => {
  it('stamps the shown type in when dice first arrive', () => {
    expect(damagePatch('1d8', undefined, 'M')).toEqual({ dmg1: '1d8', dmgType: 'S' });
    expect(damagePatch('1d6', undefined, 'R')).toEqual({ dmg1: '1d6', dmgType: 'P' });
  });

  it('never overwrites a type the author chose', () => {
    expect(damagePatch('1d10', 'C', 'M')).toEqual({ dmg1: '1d10' });
  });

  it('adds no type to an empty damage box', () => {
    expect(damagePatch('', undefined, 'M')).toEqual({ dmg1: '' });
  });
});

describe('nextRiders', () => {
  it('creates a rider carrying the type the dropdown was already showing', () => {
    expect(nextRiders([], 'dmg', '1d4')).toEqual([{ dmg: '1d4', dmgType: DEFAULT_RIDER_TYPE }]);
  });

  it('keeps a chosen type when the dice are edited afterwards', () => {
    expect(nextRiders([{ dmg: '1d4', dmgType: 'C' }], 'dmg', '2d4')).toEqual([
      { dmg: '2d4', dmgType: 'C' },
    ]);
  });

  it('drops the rider when the dice are cleared', () => {
    expect(nextRiders([{ dmg: '1d4', dmgType: 'F' }], 'dmg', '')).toBeUndefined();
  });

  it('writes nothing when only the type is set and the dice are still empty', () => {
    // Otherwise a `{ dmgType: 'C' }` renders as nothing yet survives export.
    expect(nextRiders([], 'dmgType', 'C')).toBeUndefined();
  });

  it('leaves a hand-written second rider alone', () => {
    expect(
      nextRiders(
        [
          { dmg: '1d4', dmgType: 'F' },
          { dmg: '1d6', dmgType: 'C' },
        ],
        'dmg',
        '2d4',
      ),
    ).toEqual([
      { dmg: '2d4', dmgType: 'F' },
      { dmg: '1d6', dmgType: 'C' },
    ]);
  });

  it('takes the rest of the list with it when the first rider is cleared', () => {
    expect(
      nextRiders(
        [
          { dmg: '1d4', dmgType: 'F' },
          { dmg: '1d6', dmgType: 'C' },
        ],
        'dmg',
        '',
      ),
    ).toEqual([{ dmg: '1d6', dmgType: 'C' }]);
  });
});
