// Review finding: the creator's Review said "High" and the sheet header said
// "Elf Wizard 1" for the same High Elf. One name, built one way, everywhere.
import { describe, expect, it } from 'vitest';
import { raceDisplayName } from './raceDisplayName';

const name = (race: string, subrace?: string) =>
  raceDisplayName({ name: race }, subrace === undefined ? undefined : { name: subrace });

describe('raceDisplayName', () => {
  it('puts the subrace before the race, as a player says it', () => {
    expect(name('Elf', 'High')).toBe('High Elf');
    expect(name('Dwarf', 'Hill')).toBe('Hill Dwarf');
    expect(name('Halfling', 'Lightfoot')).toBe('Lightfoot Halfling');
    expect(name('Human', 'Variant')).toBe('Variant Human');
    expect(name('Dwarf', 'Mark of Warding')).toBe('Mark of Warding Dwarf');
    // A race printed with its setting keeps it at the end.
    expect(name('Elf (Kaladesh)', 'Vahadar')).toBe('Vahadar Elf (Kaladesh)');
  });

  it('keeps a subrace name that already says the race', () => {
    expect(name('Dragonborn', 'Dragonborn (Black)')).toBe('Dragonborn (Black)');
    expect(name('Elf', 'Moon Elf')).toBe('Moon Elf');
  });

  it('brackets a variant or a setting written with a semicolon', () => {
    expect(name('Half-Orc', 'Variant; Mark of Finding')).toBe('Half-Orc (Mark of Finding)');
    expect(name('Goblin', 'Zendikar; Grotag Tribe')).toBe('Goblin (Zendikar; Grotag Tribe)');
  });

  it('is the race alone without a subrace, and nothing without a race', () => {
    expect(name('Tiefling')).toBe('Tiefling');
    expect(name('Human', '  ')).toBe('Human');
    expect(raceDisplayName(undefined, { name: 'High' })).toBeUndefined();
  });
});
