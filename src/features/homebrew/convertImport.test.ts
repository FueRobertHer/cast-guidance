import { describe, expect, it } from 'vitest';
import { convertXmlText } from '@/convert';
import { notesWith } from '@/convert/types';
import { normalizeDataset } from '@/data5e/normalize';
import { installedCheck } from './convertImport';

/** A registry with the 2014 Dwarf and its Hill subrace, and the 2024 Elf's lineages. */
function registry() {
  return normalizeDataset(
    new Map([
      [
        'races.json',
        {
          race: [
            { name: 'Dwarf', source: 'PHB', speed: 25 },
            {
              name: 'Elf',
              source: 'XPHB',
              edition: 'one',
              speed: 30,
              _versions: [{ name: 'Elf; Drow Lineage', source: 'XPHB', darkvision: 120 }],
            },
          ],
          subrace: [
            { source: 'PHB', raceName: 'Dwarf', raceSource: 'PHB' },
            { name: 'Hill', source: 'PHB', raceName: 'Dwarf', raceSource: 'PHB' },
          ],
        },
      ],
    ]),
  );
}

describe('installedCheck', () => {
  it('finds a race, a subrace and a 2024 lineage under the names other apps give them', () => {
    const isInstalled = installedCheck(registry());
    expect(isInstalled('race', 'Dwarf', '2014')).toBe(true);
    expect(isInstalled('race', 'Dwarf, Hill', '2014')).toBe(true);
    expect(isInstalled('race', 'dwarf (hill)', '2014')).toBe(true);
    expect(isInstalled('race', 'Hill Dwarf', '2014')).toBe(true);
    expect(isInstalled('race', 'Elf, Drow', '2024')).toBe(true);
    expect(isInstalled('race', 'Elf; Drow Lineage', '2024')).toBe(true);
  });

  it('keeps each to its own edition, and a subrace`s bare name to none', () => {
    const isInstalled = installedCheck(registry());
    expect(isInstalled('race', 'Dwarf, Hill', '2024')).toBe(false);
    expect(isInstalled('race', 'Elf, Drow', '2014')).toBe(false);
    expect(isInstalled('race', 'Hill', '2014')).toBe(false);
    expect(isInstalled('race', 'Dwarf, Mountain', '2014')).toBe(false);
  });

  it('leaves a Fight Club subrace the game data has out of the import', () => {
    const xml = `<compendium version="5">
      <race><name>Dwarf, Hill</name><size>M</size><speed>25</speed></race>
      <race><name>Dwarf, Mountain</name><size>M</size><speed>25</speed></race>
    </compendium>`;
    const { json, report } = convertXmlText(xml, {
      fileName: 'races.xml',
      isInstalled: installedCheck(registry()),
    });
    expect(notesWith(report, 'installed').map((n) => n.name)).toEqual(['Dwarf, Hill']);
    expect((json.race as Array<{ name: string }>).map((r) => r.name)).toEqual(['Dwarf, Mountain']);
  });
});
