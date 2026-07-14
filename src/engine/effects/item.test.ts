import { describe, expect, it } from 'vitest';
import { isArmor, isShield, itemTypeCode, parseBonus } from './item';

describe('itemTypeCode', () => {
  it('takes the code before the pipe, or undefined', () => {
    expect(itemTypeCode({ type: 'HA|XPHB' })).toBe('HA');
    expect(itemTypeCode({ type: 'M' })).toBe('M');
    expect(itemTypeCode({})).toBeUndefined();
  });
});

describe('isArmor / isShield', () => {
  it('recognizes light/medium/heavy armor', () => {
    expect(isArmor({ type: 'LA' })).toBe(true);
    expect(isArmor({ type: 'MA|PHB' })).toBe(true);
    expect(isArmor({ type: 'HA' })).toBe(true);
    expect(isArmor({ type: 'S' })).toBe(false);
    expect(isArmor({ type: 'M' })).toBe(false);
  });

  it('recognizes shields', () => {
    expect(isShield({ type: 'S' })).toBe(true);
    expect(isShield({ type: 'HA' })).toBe(false);
  });
});

describe('parseBonus', () => {
  it('reads numbers and +N strings, defaulting to 0', () => {
    expect(parseBonus(2)).toBe(2);
    expect(parseBonus('+1')).toBe(1);
    expect(parseBonus('3')).toBe(3);
    expect(parseBonus('not a number')).toBe(0);
    expect(parseBonus(undefined)).toBe(0);
  });
});
