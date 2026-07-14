import { describe, expect, it } from 'vitest';
import { COMBAT_CAPABILITIES, capabilityKey } from './combatCapabilities';

describe('capabilityKey', () => {
  it('lowercases and strips a trailing parenthetical', () => {
    expect(capabilityKey('Extra Attack')).toBe('extra attack');
    expect(capabilityKey('Extra Attack (2)')).toBe('extra attack');
    expect(capabilityKey('Sneak Attack (3d6)')).toBe('sneak attack');
  });

  it('produces keys that match the curated capability map', () => {
    expect(COMBAT_CAPABILITIES[capabilityKey('Extra Attack (2)')]).toBeDefined();
    expect(COMBAT_CAPABILITIES[capabilityKey('Cunning Action')]).toBeDefined();
  });
});
