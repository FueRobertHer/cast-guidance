import { describe, expect, it } from 'vitest';
import { convertXmlText } from '@/convert';
import {
  heldBooks,
  installedCheck,
  officialChecks,
  officialClassLookup,
  officialKeys,
} from '@/convert/official';
import { notesWith, subclassKey } from '@/convert/types';
import { normalizeDataset } from '@/data5e/normalize';

/** The 2014 Dwarf and its Hill subrace, and the 2024 Elf's lineages. */
const RACES = {
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
};

/** A registry of {@link RACES}. */
function registry() {
  return normalizeDataset(new Map([['races.json', RACES]]));
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

  it('finds a subclass on its own class only', () => {
    const reg = normalizeDataset(
      new Map<string, unknown>([
        [
          'class/class-test.json',
          {
            class: [{ name: 'Fighter', source: 'PHB' }],
            subclass: [
              {
                name: 'Champion',
                shortName: 'Champion',
                source: 'PHB',
                className: 'Fighter',
                classSource: 'PHB',
              },
            ],
          },
        ],
      ]),
    );
    const direct = installedCheck(reg);
    const copied = officialChecks(structuredClone(officialKeys(reg))).isInstalled;
    for (const isInstalled of [direct, copied]) {
      expect(isInstalled('subclass', subclassKey('Champion', 'Fighter'), '2014')).toBe(true);
      expect(isInstalled('subclass', subclassKey('Champion', 'Fighter'), '2014', 'PHB')).toBe(true);
      expect(isInstalled('subclass', subclassKey('Champion', 'Barbarian'), '2014')).toBe(false);
      expect(isInstalled('subclass', subclassKey('Champion', 'Barbarian'), '2014', 'PHB')).toBe(
        false,
      );
    }
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

describe('officialKeys', () => {
  it('answers on a worker, from a copy, as the registry does', () => {
    const reg = normalizeDataset(
      new Map<string, unknown>([
        ['races.json', RACES],
        [
          'more.json',
          {
            feat: [
              { name: 'Ember Adept', source: 'XGE' },
              { name: 'Alert', source: 'XPHB', edition: 'one' },
            ],
            item: [{ name: 'Rope, Hempen (50 feet)', source: 'PHB' }],
            background: [{ name: 'Acolyte', source: 'PHB' }],
            spell: [{ name: 'Fire Bolt', source: 'PHB', level: 0 }],
            optionalfeature: [{ name: 'Archery', source: 'PHB', featureType: ['FS:F'] }],
          },
        ],
      ]),
    );
    const direct = { isInstalled: installedCheck(reg), hasBook: heldBooks(reg) };
    const copied = officialChecks(structuredClone(officialKeys(reg)));
    const names = [
      'Dwarf',
      'Hill Dwarf',
      'Dwarf, Hill',
      'dwarf (hill)',
      'Hill',
      'Elf',
      'Elf; Drow Lineage',
      'Drow',
      'Ember Adept',
      'Alert',
      'Rope, Hempen',
      'Rope, Hempen (50 feet)',
      'Acolyte',
      'Fire Bolt',
      'Archery',
      'Nothing',
    ];
    const kinds = ['race', 'feat', 'item', 'background', 'spell', 'optionalfeature'] as const;
    let found = 0;
    for (const kind of kinds) {
      for (const name of names) {
        for (const edition of ['2014', '2024'] as const) {
          for (const book of [undefined, 'PHB', 'XGE', 'XPHB']) {
            const expected = direct.isInstalled(kind, name, edition, book);
            if (expected) found += 1;
            expect(
              copied.isInstalled(kind, name, edition, book),
              `${kind} ${name} ${edition} ${book}`,
            ).toBe(expected);
          }
        }
      }
    }
    // Enough of them are there for the comparison to mean something.
    expect(found).toBeGreaterThan(15);
    for (const code of ['PHB', 'phb', 'XGE', 'XPHB', 'TCE']) {
      expect(copied.hasBook(code), code).toBe(direct.hasBook(code));
    }
    expect(copied.rulesBooks).toEqual(reg.rulesBooks);
  });

  it('names an installed class by its own book, the core one first, from a copy too', () => {
    const reg = normalizeDataset(
      new Map<string, unknown>([
        [
          'class/class-test.json',
          {
            class: [
              { name: 'Artificer', source: 'TCE', otherSources: [{ source: 'ERLW' }] },
              { name: 'Fighter', source: 'WoW' },
              { name: 'Fighter', source: 'PHB' },
              { name: 'Fighter', source: 'XPHB', edition: 'one' },
            ],
          },
        ],
      ]),
    );
    const direct = officialClassLookup(reg);
    const copied = officialChecks(structuredClone(officialKeys(reg))).officialClass;
    for (const lookup of [direct, copied]) {
      expect(lookup('artificer', '2014')).toEqual({ name: 'Artificer', source: 'TCE' });
      expect(lookup('Fighter', '2014')).toEqual({ name: 'Fighter', source: 'PHB' });
      expect(lookup('Fighter', '2024')).toEqual({ name: 'Fighter', source: 'XPHB' });
      expect(lookup('Ember Knight', '2014')).toBeUndefined();
    }
  });
});
