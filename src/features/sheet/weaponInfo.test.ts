import { describe, expect, it } from 'vitest';
import { attackSubtitle, damageLabel, riderLabel, weaponInfoEntries } from './weaponInfo';

describe('weaponInfoEntries (property glosses, no registry)', () => {
  it('glosses known properties with title-cased labels', () => {
    const entries = weaponInfoEntries(null, 'Longsword', ['versatile', 'finesse']);
    expect(entries).toEqual([
      expect.stringMatching(/^Versatile: /),
      expect.stringMatching(/^Finesse: /),
    ]);
  });

  it('title-cases hyphenated properties', () => {
    const entries = weaponInfoEntries(null, 'Greatsword', ['two-handed']) ?? [];
    expect(entries[0]).toMatch(/^Two-Handed: /);
  });

  it('skips unknown properties', () => {
    expect(weaponInfoEntries(null, 'Club', ['made-up-prop'])).toBeUndefined();
  });

  it('is undefined when there is nothing to show', () => {
    expect(weaponInfoEntries(null, 'Club', [])).toBeUndefined();
  });
});

describe('damage riders on the attack row', () => {
  it('reads a rider as an addition to the weapon', () => {
    expect(riderLabel({ dice: '1d4', damageType: 'fire' })).toBe('+1d4 fire');
  });

  it('leaves the type off a rider that never declared one', () => {
    expect(riderLabel({ dice: '1d4' })).toBe('+1d4');
  });

  it('names the type in the roll-log label, which is where it fits', () => {
    expect(damageLabel('Flame Sword', 'fire')).toBe('Flame Sword fire damage');
    expect(damageLabel('Club')).toBe('Club damage');
  });

  it('leads the subtitle with riders, then properties, then range', () => {
    expect(
      attackSubtitle({
        extraDamage: [{ dice: '1d4', damageType: 'fire' }],
        properties: ['finesse', 'light'],
        range: '20/60 ft.',
      }),
    ).toBe('+1d4 fire · finesse, light · 20/60 ft.');
  });

  it('drops the separators for a plain weapon with nothing to say', () => {
    expect(attackSubtitle({ extraDamage: [], properties: [], range: undefined })).toBe('');
    expect(attackSubtitle({ extraDamage: [], properties: ['heavy'] })).toBe('heavy');
  });
});
