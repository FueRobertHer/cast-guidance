import { describe, expect, it } from 'vitest';
import type { FeatureCard } from '@/engine/types';
import { COMBAT_CAPABILITIES, capabilityKey, collectCapabilityCards } from './combatCapabilities';

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

describe('collectCapabilityCards', () => {
  // Race feature cards hold all traits nested in one card, the way collectRace
  // builds them: one card named after the race, traits as named sub-entries.
  const satyr: FeatureCard = {
    name: 'Satyr',
    origin: { label: 'Satyr', uid: 'satyr|mot', type: 'race' },
    entries: [
      {
        name: 'Magic Resistance',
        entries: ['You have advantage on saving throws against spells.'],
      },
      { name: 'Mirthful Leaps', entries: ['Whenever you make a long or high jump…'] },
      { name: 'Reveler', entries: ['You have proficiency in Performance and Persuasion.'] },
    ],
  };
  const extraAttack: FeatureCard = {
    name: 'Extra Attack',
    origin: { label: 'Fighter', uid: 'fighter|phb', type: 'class' },
    entries: ['You can attack twice.'],
  };

  it('finds traits nested inside a race card', () => {
    const cards = collectCapabilityCards([satyr]);
    expect(cards.map((c) => c.key)).toEqual(['magic resistance', 'mirthful leaps']);
    expect(cards[0]).toMatchObject({
      name: 'Magic Resistance',
      origin: 'Satyr',
      blurb: COMBAT_CAPABILITIES['magic resistance'],
    });
    // The trait's own text, not the whole race card, backs the info sheet.
    expect(cards[0]?.entries).toEqual(['You have advantage on saving throws against spells.']);
  });

  it('still matches top-level feature names and drops excluded keys', () => {
    const cards = collectCapabilityCards([extraAttack, satyr], new Set(['magic resistance']));
    expect(cards.map((c) => c.key)).toEqual(['extra attack', 'mirthful leaps']);
  });

  it('dedupes a capability that appears in several cards', () => {
    const twice = collectCapabilityCards([satyr, { ...satyr, name: 'Satyr (again)' }]);
    expect(twice.filter((c) => c.key === 'magic resistance')).toHaveLength(1);
  });
});
