import { describe, expect, it } from 'vitest';
import { HOMEBREW_ENTITY_KEYS } from './guards';
import { kindCount, kindName } from './kindLabels';

describe('kind labels', () => {
  it('names every kind a homebrew file holds in words, never as its key', () => {
    for (const type of HOMEBREW_ENTITY_KEYS) {
      const one = kindName(type);
      const many = kindName(type, 2);
      expect(one, type).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
      expect(many, type).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
      expect(one === type && /[A-Z]/.test(type), type).toBe(false);
    }
  });

  it('counts in sentence case, one and many', () => {
    expect(kindCount('subclassFeature', 3)).toBe('3 subclass features');
    expect(kindCount('spell', 1)).toBe('1 spell');
    expect(kindCount('spell', 0)).toBe('0 spells');
    expect(kindCount('race', 2)).toBe('2 species');
    expect(kindCount('class', 2)).toBe('2 classes');
  });

  it('spells out a key it does not know', () => {
    expect(kindName('deityGroup', 2)).toBe('Deity groups');
    expect(kindName('trap_hazard')).toBe('Trap hazard');
    expect(kindName('')).toBe('Entry');
  });
});
