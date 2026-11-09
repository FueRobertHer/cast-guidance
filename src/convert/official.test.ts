import { describe, expect, it } from 'vitest';
import { officialNames } from './official';

describe('officialNames', () => {
  it('names most entries by their own name only', () => {
    expect(officialNames('race', { name: 'Dwarf', source: 'PHB' })).toEqual(['dwarf']);
    expect(officialNames('spell', { name: 'Fireball', source: 'PHB' })).toEqual(['fireball']);
    // Items have versions too, which go by their own name.
    expect(
      officialNames('item', { name: 'Bag (Red)', source: 'XDMG', _versionOf: 'bag|xdmg' }),
    ).toEqual(['bag (red)']);
  });

  it('names a subrace as other apps name it as a race, never by its own name alone', () => {
    const names = officialNames('subrace', {
      name: 'Hill',
      source: 'PHB',
      raceName: 'Dwarf',
      raceSource: 'PHB',
    });
    expect(names).toEqual(expect.arrayContaining(['dwarf, hill', 'dwarf (hill)', 'hill dwarf']));
    expect(names).not.toContain('hill');
  });

  it('gives a nameless subrace, its race`s own base entry, no name', () => {
    expect(officialNames('subrace', { source: 'PHB', raceName: 'Tiefling' })).toEqual([]);
  });

  it('reads the race out of a subrace that carries it in its name', () => {
    const names = officialNames('subrace', {
      name: 'Dragonborn (Black)',
      source: 'PHB',
      raceName: 'Dragonborn',
    });
    expect(names).toEqual(
      expect.arrayContaining(['dragonborn (black)', 'dragonborn, black', 'black dragonborn']),
    );
  });

  it('names a 2024 lineage by its race and what it is, with or without the word', () => {
    const elf = officialNames('race', {
      name: 'Elf; High Elf Lineage',
      source: 'XPHB',
      _versionOf: 'elf|xphb',
    });
    expect(elf).toEqual(
      expect.arrayContaining([
        'elf; high elf lineage',
        'elf, high elf lineage',
        'elf, high',
        'elf (high)',
        'high elf',
      ]),
    );
    const tiefling = officialNames('race', {
      name: 'Tiefling; Abyssal Legacy',
      source: 'XPHB',
      _versionOf: 'tiefling|xphb',
    });
    expect(tiefling).toEqual(expect.arrayContaining(['tiefling, abyssal', 'abyssal tiefling']));
    const goliath = officialNames('race', {
      name: 'Goliath; Cloud Giant Ancestry',
      source: 'XPHB',
      _versionOf: 'goliath|xphb',
    });
    expect(goliath).toEqual(
      expect.arrayContaining(['goliath, cloud giant', 'cloud giant goliath']),
    );
  });

  it('names a subrace of a race in brackets as 5etools shows it', () => {
    const names = officialNames('subrace', {
      name: 'Joraga Nation',
      source: 'PSZ',
      raceName: 'Elf (Zendikar)',
      raceSource: 'PSZ',
    });
    expect(names).toContain('elf (zendikar; joraga nation)');
    expect(names).toContain('elf (zendikar), joraga nation');
    expect(names).not.toContain('joraga nation elf (zendikar)');
  });

  it('puts a qualifier with a semicolon after the race only', () => {
    const names = officialNames('subrace', {
      name: 'Variant; Hellfire',
      source: 'SCAG',
      raceName: 'Tiefling',
    });
    expect(names).toEqual(['tiefling, variant; hellfire', 'tiefling (variant; hellfire)']);
  });

  it('names a version of a race that does not carry the race`s name by its own name', () => {
    expect(officialNames('race', { name: 'Other', source: 'X', _versionOf: 'elf|xphb' })).toEqual([
      'other',
    ]);
  });
});
