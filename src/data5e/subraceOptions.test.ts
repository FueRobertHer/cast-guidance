import { describe, expect, it } from 'vitest';
import type { Entity } from './copyMod';
import { subraceOptions } from './subraceOptions';

// As the 5etools data has them: VGM's Aasimar has subraces, MPMM's and the
// 2024 one have none, and both Genasi printings have their own.
const all: Entity[] = [
  { name: 'Protector', source: 'VGM', raceName: 'Aasimar', raceSource: 'VGM' },
  { name: 'Scourge', source: 'VGM', raceName: 'Aasimar', raceSource: 'VGM' },
  { name: 'Air', source: 'EEPC', raceName: 'Genasi', raceSource: 'EEPC' },
  { name: 'Air', source: 'MPMM', raceName: 'Genasi', raceSource: 'MPMM' },
  { name: 'High', source: 'PHB', raceName: 'Elf', raceSource: 'PHB' },
  // Another book's subrace for the PHB Elf.
  { name: 'Eladrin', source: 'DMG', raceName: 'Elf', raceSource: 'PHB' },
  // The race's own base entry, which has no name.
  { source: 'PHB', raceName: 'Elf', raceSource: 'PHB' },
];
const uids = (list: Entity[]) => list.map((s) => `${String(s.name)}|${String(s.source)}`);

describe('subraceOptions', () => {
  it("offers only the subraces of the race's own printing", () => {
    expect(uids(subraceOptions(all, { name: 'Aasimar', source: 'VGM' }))).toEqual([
      'Protector|VGM',
      'Scourge|VGM',
    ]);
    expect(subraceOptions(all, { name: 'Aasimar', source: 'MPMM' })).toEqual([]);
    expect(uids(subraceOptions(all, { name: 'Genasi', source: 'MPMM' }))).toEqual(['Air|MPMM']);
  });

  it('gives the 2024 Elf none of the 2014 subraces', () => {
    expect(subraceOptions(all, { name: 'Elf', source: 'XPHB' })).toEqual([]);
    expect(uids(subraceOptions(all, { name: 'elf', source: 'phb' }))).toEqual([
      'High|PHB',
      'Eladrin|DMG',
    ]);
  });

  it('keeps a held subrace that names another printing, so it can be unselected', () => {
    const list = subraceOptions(
      all,
      { name: 'Elf', source: 'XPHB' },
      { name: 'High', source: 'PHB' },
    );
    expect(uids(list)).toEqual(['High|PHB']);
  });

  it('matches a subrace with no race source by name alone', () => {
    const homebrew: Entity[] = [{ name: 'Moon', source: 'HB', raceName: 'Elf' }];
    expect(uids(subraceOptions(homebrew, { name: 'Elf', source: 'XPHB' }))).toEqual(['Moon|HB']);
  });
});
