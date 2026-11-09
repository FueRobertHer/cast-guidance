import { describe, expect, it } from 'vitest';
import { convertXmlText } from '@/convert';
import { heldBooks, installedCheck } from '@/convert/official';
import { notesWith } from '@/convert/types';
import { normalizeDataset } from '@/data5e/normalize';

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

  it('finds an entry in its book and in the books it is reprinted in', () => {
    const reg = normalizeDataset(
      new Map([
        [
          'feats.json',
          { feat: [{ name: 'Ember Adept', source: 'XGE', otherSources: [{ source: 'EEPC' }] }] },
        ],
      ]),
    );
    const isInstalled = installedCheck(reg);
    expect(isInstalled('feat', 'Ember Adept', '2014', 'XGE')).toBe(true);
    expect(isInstalled('feat', 'Ember Adept', '2014', 'EEPC')).toBe(true);
    expect(isInstalled('feat', 'Ember Adept', '2014', 'TCE')).toBe(false);
  });

  it('finds a fighting style filed as a feat, in its book only', () => {
    const reg = normalizeDataset(
      new Map([
        [
          'optionalfeatures.json',
          { optionalfeature: [{ name: 'Ember Style', source: 'TCE', featureType: ['FS:F'] }] },
        ],
      ]),
    );
    const isInstalled = installedCheck(reg);
    expect(isInstalled('feat', 'Ember Style', '2014', 'TCE')).toBe(true);
    expect(isInstalled('feat', 'Ember Style', '2014')).toBe(false);
  });

  it('finds an item or background without the bracket 5etools adds, in its book only', () => {
    const reg = normalizeDataset(
      new Map<string, unknown>([
        ['items-base.json', { baseitem: [{ name: 'Ember Darts (20)', source: 'PHB', type: 'A' }] }],
        ['backgrounds.json', { background: [{ name: 'Ash Scholar (Sage)', source: 'EGW' }] }],
      ]),
    );
    const isInstalled = installedCheck(reg);
    expect(isInstalled('item', 'Ember Darts', '2014', 'PHB')).toBe(true);
    expect(isInstalled('item', 'Ember Darts', '2014')).toBe(false);
    expect(isInstalled('background', 'Ash Scholar', '2014', 'EGW')).toBe(true);
    expect(isInstalled('background', 'Sage (Ash Scholar)', '2014', 'EGW')).toBe(true);
  });

  it('finds a name spelled with other spaces or hyphens, in its book only', () => {
    const reg = normalizeDataset(
      new Map([['feats.json', { feat: [{ name: 'Ember-Flame Adept', source: 'XGE' }] }]]),
    );
    const isInstalled = installedCheck(reg);
    expect(isInstalled('feat', 'Emberflame Adept', '2014', 'XGE')).toBe(true);
    expect(isInstalled('feat', 'Emberflame Adept', '2014')).toBe(false);
  });

  it('says which books the data holds anything from', () => {
    const held = heldBooks(
      normalizeDataset(
        new Map([['feats.json', { feat: [{ name: 'Ember Adept', source: 'XGE' }] }]]),
      ),
    );
    expect(held('XGE')).toBe(true);
    expect(held('xge')).toBe(true);
    expect(held('TCE')).toBe(false);
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
