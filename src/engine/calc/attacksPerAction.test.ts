import { describe, expect, it } from 'vitest';
import type { FeatureCard } from '../types';
import { attacksPerAction } from './attacksPerAction';

const fighter = { label: 'Fighter', uid: 'x', type: 'class' } as const;

function feature(name: string, entries: unknown = []): FeatureCard {
  return { name, origin: fighter, entries };
}

describe('attacksPerAction', () => {
  it('returns 1 with no features', () => {
    expect(attacksPerAction([])).toBe(1);
  });

  it('returns 1 when no feature grants extra attacks', () => {
    expect(attacksPerAction([feature('Second Wind'), feature('Action Surge')])).toBe(1);
  });

  it('gives 2 for Extra Attack', () => {
    expect(attacksPerAction([feature('Extra Attack')])).toBe(2);
  });

  it('gives n + 1 for Extra Attack (n)', () => {
    expect(attacksPerAction([feature('Extra Attack (2)')])).toBe(3);
    expect(attacksPerAction([feature('Extra Attack (3)')])).toBe(4);
  });

  it('gives 2 for Extra Attack with a non-numeric parenthetical', () => {
    expect(attacksPerAction([feature('Extra Attack (Fighter)')])).toBe(2);
  });

  it('gives 3 for Two Extra Attacks and 4 for Three Extra Attacks', () => {
    expect(attacksPerAction([feature('Two Extra Attacks')])).toBe(3);
    expect(attacksPerAction([feature('Three Extra Attacks')])).toBe(4);
  });

  it('gives 3 for Extra Attack Improvement', () => {
    expect(attacksPerAction([feature('Extra Attack Improvement')])).toBe(3);
  });

  it('gives 2 for Thirsting Blade and 3 for Devouring Blade', () => {
    expect(attacksPerAction([feature('Thirsting Blade')])).toBe(2);
    expect(attacksPerAction([feature('Devouring Blade')])).toBe(3);
  });

  it('takes the maximum when several features match', () => {
    expect(attacksPerAction([feature('Extra Attack'), feature('Two Extra Attacks')])).toBe(3);
    expect(attacksPerAction([feature('Two Extra Attacks'), feature('Extra Attack')])).toBe(3);
    expect(attacksPerAction([feature('Extra Attack (3)'), feature('Devouring Blade')])).toBe(4);
  });

  it('matches names case-insensitively after trimming', () => {
    expect(attacksPerAction([feature('  EXTRA attack  ')])).toBe(2);
    expect(attacksPerAction([feature('\tthree extra ATTACKS\n')])).toBe(4);
    expect(attacksPerAction([feature(' extra attack (2) ')])).toBe(3);
  });

  it('does not treat inherited object keys as named features', () => {
    expect(attacksPerAction([feature('constructor'), feature('__proto__')])).toBe(1);
  });

  it('counts a nested trait inside a feature entries', () => {
    const race: FeatureCard = {
      name: 'Dwarven Warrior',
      origin: { label: 'Dwarf', uid: 'y', type: 'race' },
      entries: [
        { name: 'Darkvision', entries: ['See in the dark.'] },
        { name: 'Extra Attack', entries: ['Attack twice.'] },
      ],
    };
    expect(attacksPerAction([race])).toBe(2);
  });

  it('counts a nested trait inside items and deeper entries', () => {
    const race = feature('Some Race', [
      { name: 'Outer', entries: [{ name: 'Devouring Blade', entries: [] }] },
      { name: 'List', items: [{ name: 'Two Extra Attacks' }] },
    ]);
    expect(attacksPerAction([race])).toBe(3);
  });

  it('ignores names that are only partial matches', () => {
    expect(attacksPerAction([feature('Extra Attacks'), feature('Attack Extra')])).toBe(1);
  });

  it('treats Extra Attack (Fighter) as 2', () => {
    expect(attacksPerAction([feature('Extra Attack (Fighter)')])).toBe(2);
  });
});
