import { describe, expect, it } from 'vitest';
import { weaponInfoEntries } from './weaponInfo';

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
