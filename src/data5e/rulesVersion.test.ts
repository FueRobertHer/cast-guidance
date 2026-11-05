import { afterEach, describe, expect, it } from 'vitest';
import type { Entity } from './copyMod';
import { type EntityType, mergeHomebrew, normalizeDataset } from './normalize';
import {
  editionOf,
  filterByRulesVersion,
  isBook2024,
  pickForVersion,
  reprintTargets,
  setRulesBooks,
} from './rulesVersion';

const exhaustion2014: Entity = { name: 'Exhaustion', source: 'PHB', entries: ['2014 table'] };
const exhaustion2024: Entity = { name: 'Exhaustion', source: 'XPHB', entries: ['2024 linear'] };

describe('the books a release marks as 2024 rules', () => {
  afterEach(() => setRulesBooks(new Set()));

  const release = () =>
    normalizeDataset(
      new Map<string, unknown>([
        ['backgrounds.json', { background: [{ name: 'Bg', source: 'LATE', edition: 'one' }] }],
        [
          'races.json',
          {
            race: [
              { name: 'Base', source: 'XPHB', edition: 'one' },
              { name: 'Kin', source: 'OLD', _copy: { name: 'Base', source: 'XPHB' } },
            ],
          },
        ],
      ]),
    );

  it('keeps the set on the registry, reading no book from an inherited mark', () => {
    expect([...release().rulesBooks].sort()).toEqual(['LATE', 'XPHB']);
  });

  it('adds nothing for homebrew, whatever its rows claim', () => {
    const reg = release();
    mergeHomebrew(
      reg,
      new Map([
        [
          'brew',
          {
            feat: [
              { name: 'Own', source: 'MINE', edition: 'one' },
              { name: 'Claim', source: 'OLD', edition: 'one' },
            ],
          },
        ],
      ]),
    );
    expect([...reg.rulesBooks].sort()).toEqual(['LATE', 'XPHB']);
  });

  it('answers for a book once published, and for the core books before that', () => {
    expect(isBook2024('XMM')).toBe(true);
    expect(isBook2024('LATE')).toBe(false);
    setRulesBooks(release().rulesBooks);
    expect(isBook2024('LATE')).toBe(true);
    expect(isBook2024('OLD')).toBe(false);
  });

  it('forgets a book the next build does not have', () => {
    setRulesBooks(release().rulesBooks);
    setRulesBooks(new Set());
    expect(isBook2024('LATE')).toBe(false);
    // The core books are named, so no build can drop them.
    expect(isBook2024('XPHB')).toBe(true);
  });

  it('leaves editionOf reading rows, not what was last published', () => {
    setRulesBooks(new Set(['OLD']));
    expect(editionOf({ name: 'Bare', source: 'OLD' })).toBe('2014');
  });
});

describe('editionOf over a normalized dataset', () => {
  /** A release whose `LATE` book marks only its background, as the later books do. */
  const release = (extra: Record<string, unknown> = {}) =>
    normalizeDataset(
      new Map<string, unknown>([
        ['backgrounds.json', { background: [{ name: 'Bg', source: 'LATE', edition: 'one' }] }],
        ['feats.json', { feat: [{ name: 'Bare', source: 'LATE' }] }],
        ['spells/spells-late.json', { spell: [{ name: 'Bolt', source: 'LATE' }] }],
        ...Object.entries(extra),
      ]),
    );
  const read = (reg: ReturnType<typeof release>, type: EntityType, name: string, source: string) =>
    editionOf(reg.get(type, name, source) as Entity);

  it('reads an unmarked entity by its book, whichever file marked the book', () => {
    const reg = release();
    expect(read(reg, 'feat', 'Bare', 'LATE')).toBe('2024');
    expect(read(reg, 'spell', 'Bolt', 'LATE')).toBe('2024');
  });

  it("lets an entity's own classic mark win over its book", () => {
    const reg = release({
      'optionalfeatures.json': {
        optionalfeature: [{ name: 'Old Way', source: 'LATE', edition: 'classic' }],
      },
    });
    expect(read(reg, 'optionalfeature', 'Old Way', 'LATE')).toBe('2014');
    expect(read(reg, 'feat', 'Bare', 'LATE')).toBe('2024');
  });

  it('leaves a book with no one mark alone, classic marked or bare', () => {
    const reg = release({
      'races.json': {
        race: [
          { name: 'Marked', source: 'OLD', edition: 'classic' },
          { name: 'Plain', source: 'OLD' },
        ],
      },
    });
    expect(read(reg, 'race', 'Marked', 'OLD')).toBe('2014');
    expect(read(reg, 'race', 'Plain', 'OLD')).toBe('2014');
  });

  it('still reads an unmarked core book as 2024 from its source', () => {
    const reg = release({ 'languages.json': { language: [{ name: 'Tongue', source: 'XMM' }] } });
    expect(read(reg, 'language', 'Tongue', 'XMM')).toBe('2024');
  });

  it('reads no book from a mark one of its rows only inherited', () => {
    const reg = release({
      'races.json': {
        race: [
          { name: 'Base', source: 'XPHB', edition: 'one' },
          { name: 'Kin', source: 'OLD', _copy: { name: 'Base', source: 'XPHB' } },
          { name: 'Original', source: 'OLD' },
        ],
      },
    });
    // The copy is 2024 content, but that says nothing about the rest of its book.
    expect(read(reg, 'race', 'Kin', 'OLD')).toBe('2024');
    expect(read(reg, 'race', 'Original', 'OLD')).toBe('2014');
  });

  it('keeps a row in an older book that copies a bare row from a 2024 book at 2014', () => {
    // Older adventures do this with core items. The target reads 2024 by its
    // book, but the mark it would pass on was never written on it.
    const reg = release({
      'items.json': {
        item: [
          { name: 'Cloak', source: 'LATE' },
          { name: 'Cloak', source: 'OLD', _copy: { name: 'Cloak', source: 'LATE' } },
        ],
      },
    });
    expect(read(reg, 'item', 'Cloak', 'LATE')).toBe('2024');
    expect(read(reg, 'item', 'Cloak', 'OLD')).toBe('2014');
  });

  it('keeps a classic a row inherited, since it copied 2014 content', () => {
    const reg = release({
      'races.json': {
        race: [
          { name: 'Kin', source: 'PHB', edition: 'classic' },
          { name: 'Kin', source: 'LATE', _copy: { name: 'Kin', source: 'PHB' } },
        ],
      },
    });
    expect(read(reg, 'race', 'Kin', 'LATE')).toBe('2014');
  });

  it('carries the mark into a version expanded from an unmarked race', () => {
    const reg = release({
      'races.json': {
        race: [
          { name: 'Folk', source: 'LATE', _versions: [{ name: 'Folk; Variant', source: 'LATE' }] },
        ],
      },
    });
    expect(read(reg, 'race', 'Folk; Variant', 'LATE')).toBe('2024');
  });

  it('does not let a homebrew mark flip an official book or the rest of a brew', () => {
    const reg = release({ 'feats.json': { feat: [{ name: 'Plain', source: 'PHB' }] } });
    mergeHomebrew(
      reg,
      new Map([
        [
          'brew',
          {
            feat: [
              { name: 'Claims PHB', source: 'PHB', edition: 'one' },
              { name: 'Marked', source: 'MINE', edition: 'one' },
              { name: 'Bare', source: 'MINE' },
            ],
          },
        ],
      ]),
    );
    expect(read(reg, 'feat', 'Plain', 'PHB')).toBe('2014');
    expect(read(reg, 'feat', 'Bare', 'MINE')).toBe('2014');
    expect(read(reg, 'feat', 'Marked', 'MINE')).toBe('2024');
  });

  it('passes a homebrew copy only the mark its target actually carries', () => {
    const reg = release();
    mergeHomebrew(
      reg,
      new Map([
        [
          'brew',
          {
            feat: [
              { name: 'Mine', source: 'MINE', _copy: { name: 'Bare', source: 'LATE' } },
              // Preserving everything still does not bring the book's reading along.
              {
                name: 'Kept',
                source: 'MINE',
                _copy: { name: 'Bare', source: 'LATE', _preserve: { '*': true } },
              },
            ],
            background: [{ name: 'Mine', source: 'MINE', _copy: { name: 'Bg', source: 'LATE' } }],
          },
        ],
      ]),
    );
    expect(read(reg, 'feat', 'Mine', 'MINE')).toBe('2014');
    expect(read(reg, 'feat', 'Kept', 'MINE')).toBe('2014');
    expect(read(reg, 'background', 'Mine', 'MINE')).toBe('2024');
  });
});

describe('pickForVersion', () => {
  it('picks the printing matching the character rules version', () => {
    const both = [exhaustion2014, exhaustion2024];
    expect(pickForVersion(both, '2014')?.source).toBe('PHB');
    expect(pickForVersion(both, '2024')?.source).toBe('XPHB');
    // Order-independent.
    expect(pickForVersion([exhaustion2024, exhaustion2014], '2014')?.source).toBe('PHB');
  });

  it('falls back to any printing when the exact edition is absent', () => {
    expect(pickForVersion([exhaustion2014], '2024')?.source).toBe('PHB');
    expect(pickForVersion([], '2024')).toBeUndefined();
  });

  it('honors an explicit edition tag over the source heuristic', () => {
    const tagged: Entity = { name: 'Foo', source: 'HOMEBREW', edition: 'one' };
    expect(pickForVersion([tagged], '2024')?.name).toBe('Foo');
    expect(pickForVersion([tagged], '2014')?.name).toBe('Foo'); // fallback
  });
});

describe('reprintTargets', () => {
  const targets = (reprintedAs: unknown, holderType?: EntityType) =>
    reprintTargets({ name: 'A', source: 'PHB', reprintedAs } as Entity, holderType);

  it('reads both the string and the { uid } forms', () => {
    expect(targets(['Fighter|XPHB'])).toEqual([{ name: 'Fighter', source: 'XPHB' }]);
    expect(targets([{ uid: 'Fighter|XPHB' }])).toEqual([{ name: 'Fighter', source: 'XPHB' }]);
    expect(targets(['A|X', { uid: 'B|Y' }])).toEqual([
      { name: 'A', source: 'X' },
      { name: 'B', source: 'Y' },
    ]);
  });

  it('keeps only the name and source of an ordinary uid', () => {
    expect(targets(['Elf|XPHB|anything'])).toEqual([{ name: 'Elf', source: 'XPHB' }]);
  });

  it('reads a subclass uid by its shortName and its last segment', () => {
    // ShortName|ClassName|ClassSource|SubclassSource. Taking the first two
    // segments would put the class name ("Cleric") in the source slot and look
    // up a subclass that does not exist.
    expect(targets(['Life|Cleric|XPHB|XPHB'], 'subclass')).toEqual([
      { name: 'Life', shortName: 'Life', source: 'XPHB', type: 'subclass' },
    ]);
    // The subclass source is not always the class source.
    expect(targets(['Knowledge|Cleric|XPHB|FRHoF'], 'subclass')).toEqual([
      { name: 'Knowledge', shortName: 'Knowledge', source: 'FRHoF', type: 'subclass' },
    ]);
  });

  it('sends a subrace reprint to the race bucket, since 2024 folds them in', () => {
    expect(targets(['Elf|XPHB'], 'subrace')).toEqual([
      { name: 'Elf', source: 'XPHB', type: 'race' },
    ]);
  });

  it('lets an entry tag override where the target is looked for', () => {
    expect(targets([{ uid: 'Mark of Warding|EFA', tag: 'feat' }], 'subrace')).toEqual([
      { name: 'Mark of Warding', source: 'EFA', type: 'feat' },
    ]);
    // An unrecognised tag falls back rather than inventing a bucket.
    expect(targets([{ uid: 'Elf|XPHB', tag: 'nonsense' }], 'race')).toEqual([
      { name: 'Elf', source: 'XPHB', type: 'race' },
    ]);
  });

  it('ignores entries it cannot read rather than inventing a target', () => {
    // A half-written uid would otherwise become a lookup for the empty source,
    // which matches nothing and reads as "no reprint" for the wrong reason.
    expect(targets(['NoSource'])).toEqual([]);
    expect(targets(['|XPHB'])).toEqual([]);
    expect(targets(['Elf|'])).toEqual([]);
    // A subclass uid that stops short has no source segment to read.
    expect(targets(['Life|Cleric|XPHB'], 'subclass')).toEqual([]);
    expect(targets(['Life|Cleric|XPHB|'], 'subclass')).toEqual([]);
    expect(targets([42, null, {}, { uid: 7 }])).toEqual([]);
    expect(targets(undefined)).toEqual([]);
    expect(targets('Fighter|XPHB')).toEqual([]); // not an array
  });
});

describe('filterByRulesVersion', () => {
  const names = (list: Entity[]) => list.map((e) => `${String(e.name)}|${String(e.source)}`);

  it('keeps only 2014 printings for a 2014 character, and any pick it was told to keep', () => {
    const list: Entity[] = [
      { name: 'Old', source: 'PHB' },
      { name: 'New', source: 'XPHB' },
      { name: 'Tagged', source: 'HB', edition: 'one' },
    ];
    expect(names(filterByRulesVersion(list, '2014'))).toEqual(['Old|PHB']);
    expect(names(filterByRulesVersion(list, '2014', { keep: (e) => e.name === 'New' }))).toEqual([
      'Old|PHB',
      'New|XPHB',
    ]);
  });

  it('filters a normalized list by book, not only by the marks its rows carry', () => {
    const reg = normalizeDataset(
      new Map<string, unknown>([
        ['backgrounds.json', { background: [{ name: 'Bg', source: 'LATE', edition: 'one' }] }],
        [
          'feats.json',
          {
            feat: [
              { name: 'Old', source: 'PHB', reprintedAs: ['Old|LATE'] },
              { name: 'Old', source: 'LATE' },
            ],
          },
        ],
      ]),
    );
    const feats = [...reg.byType('feat')];
    expect(names(filterByRulesVersion(feats, '2014'))).toEqual(['Old|PHB']);
    expect(names(filterByRulesVersion(feats, '2024'))).toEqual(['Old|LATE']);
  });

  it('hides a 2014 printing for a 2024 character only when its reprint is in the list', () => {
    const old: Entity = { name: 'Elf', source: 'PHB', reprintedAs: ['Elf|XPHB'] };
    const reprint: Entity = { name: 'Elf', source: 'XPHB' };
    expect(names(filterByRulesVersion([old, reprint], '2024'))).toEqual(['Elf|XPHB']);
    // A carry-over with nothing to replace it is valid in a 2024 game.
    expect(names(filterByRulesVersion([old], '2024'))).toEqual(['Elf|PHB']);
  });

  it('still reads a tagged target for a caller that names no holder type', () => {
    const old: Entity = {
      name: 'Old',
      source: 'PHB',
      reprintedAs: [{ uid: 'New|XPHB', tag: 'race' }],
    };
    const reprint: Entity = { name: 'New', source: 'XPHB' };
    expect(names(filterByRulesVersion([old, reprint], '2024'))).toEqual(['New|XPHB']);
  });

  it('reads a four-segment subclass reprint, which used to leave both printings listed', () => {
    // GAME-009 cause A: read as Name|SOURCE, the uid put the class name in the
    // source slot and matched nothing.
    const old: Entity = {
      name: 'Purple Dragon Knight (Banneret)',
      shortName: 'Purple Dragon Knight (Banneret)',
      source: 'SCAG',
      reprintedAs: ['Banneret|Fighter|XPHB|FRHoF'],
    };
    const reprint: Entity = {
      name: 'Banneret',
      shortName: 'Banneret',
      source: 'FRHoF',
      edition: 'one',
    };
    expect(filterByRulesVersion([old, reprint], '2024')).toHaveLength(2);
    expect(names(filterByRulesVersion([old, reprint], '2024', { holderType: 'subclass' }))).toEqual(
      ['Banneret|FRHoF'],
    );
  });

  it('matches a subclass target by the short name it uses, not the full name', () => {
    const old: Entity = {
      name: 'Life Domain',
      shortName: 'Life',
      source: 'PHB',
      reprintedAs: ['Life|Cleric|XPHB|XPHB'],
    };
    const reprint: Entity = { name: 'Life Domain', shortName: 'Life', source: 'XPHB' };
    expect(names(filterByRulesVersion([old, reprint], '2024', { holderType: 'subclass' }))).toEqual(
      ['Life Domain|XPHB'],
    );
  });

  it('keeps a pick it was told to keep even when its reprint is listed', () => {
    const old: Entity = { name: 'Elf', source: 'PHB', reprintedAs: ['Elf|XPHB'] };
    const reprint: Entity = { name: 'Elf', source: 'XPHB' };
    expect(
      names(filterByRulesVersion([old, reprint], '2024', { keep: (e) => e.source === 'PHB' })),
    ).toEqual(['Elf|PHB', 'Elf|XPHB']);
  });

  it('ignores a target in another bucket when it knows what the list holds', () => {
    // A race tagged as reprinted into a feat says nothing about the race list,
    // even when a race happens to share the feat's name and source.
    const old: Entity = {
      name: 'Old',
      source: 'PHB',
      reprintedAs: [{ uid: 'Same|XPHB', tag: 'feat' }],
    };
    const namesake: Entity = { name: 'Same', source: 'XPHB' };
    expect(names(filterByRulesVersion([old, namesake], '2024', { holderType: 'race' }))).toEqual([
      'Old|PHB',
      'Same|XPHB',
    ]);
  });
});
