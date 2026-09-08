// The damage-type dropdowns show a default before they are touched. These
// rules are what stops that default from being a label the form shows and the
// saved file disagrees with: a weapon that read "slashing" in the builder and
// came out untyped, and a rider that read "fire" and burned nothing.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RIDER_TYPE,
  damagePatch,
  defaultDamageType,
  nextRiders,
  pruneItemFields,
} from './itemFields';

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

describe('pruneItemFields', () => {
  it('drops a base AC the type no longer has a box for', () => {
    // Heavy armor first, then a ring: the AC field leaves the form, and the 18
    // it held has to leave with it.
    expect(pruneItemFields({ type: 'RG', ac: 18, bonusAc: '+1' })).toEqual({
      type: 'RG',
      bonusAc: '+1',
    });
  });

  it('keeps a base AC on armor and shields, source-suffixed types included', () => {
    expect(pruneItemFields({ type: 'S', ac: 2 })).toEqual({ type: 'S', ac: 2 });
    expect(pruneItemFields({ type: 'S|XPHB', ac: 2 })).toEqual({ type: 'S|XPHB', ac: 2 });
    expect(pruneItemFields({ type: 'HA', ac: 18 })).toEqual({ type: 'HA', ac: 18 });
  });

  it('drops weapon damage and to-hit from something that stopped being a weapon', () => {
    expect(
      pruneItemFields({
        type: 'W',
        dmg1: '1d8',
        dmgType: 'S',
        extraDamage: [{ dmg: '1d6', dmgType: 'F' }],
        bonusWeapon: '+1',
      }),
    ).toEqual({ type: 'W' });
  });

  it('keeps the AC bonus whatever the type is', () => {
    // The shield case: the engine adds `bonusAc` to a shield's own AC, so a +1
    // shield is 2 and "+1", not a 3 typed into the base box.
    expect(pruneItemFields({ type: 'S', ac: 2, bonusAc: '+1' })).toEqual({
      type: 'S',
      ac: 2,
      bonusAc: '+1',
    });
  });

  it('leaves fields no type gates alone', () => {
    const gear = { type: 'G', rarity: 'rare', weight: 6, value: 1000, reqAttune: true };
    expect(pruneItemFields(gear)).toEqual(gear);
  });

  it('treats an untyped entity as the gear the form shows it as', () => {
    expect(pruneItemFields({ ac: 18, dmg1: '1d8' })).toEqual({});
  });
});
