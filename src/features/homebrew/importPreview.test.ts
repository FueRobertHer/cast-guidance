import { describe, expect, it } from 'vitest';
import {
  EntityRegistry,
  type EntityType,
  identityKey,
  mergeHomebrew,
  normalizeDataset,
} from '@/data5e/normalize';
import type { HomebrewFileRow } from '@/db/db';
import type { HomebrewFile } from '@/db/homebrewRepo';
import { newCharacterDoc } from '@/engine/types';
import { writeChange } from '@/features/workshop/copyWriter';
import { IMPORT_LIMITS } from '@/lib/guards';
import {
  clashKey,
  describeCollision,
  entryChanges,
  MAX_LISTED_COLLISIONS,
  type OfficialIndex,
  officialIndexFrom,
  type PackReplacement,
  packReplaces,
  packReview,
  previewHomebrewImport,
  replacedRow,
  WINNER_POLICY,
  whereIn,
} from './importPreview';

type Json = Record<string, unknown>;

function meta(sourceIds: string[], extra: Json = {}): Json {
  return { sources: sourceIds.map((s) => ({ json: s, full: `${s} Book` })), ...extra };
}

function spell(name: string, source: string, extra: Json = {}): Json {
  return { name, source, level: 1, ...extra };
}

/** The prepared row a new import would store. */
function row(json: Json, id = 'new-file'): HomebrewFileRow {
  const sources = (json._meta as { sources: { json: string }[] }).sources;
  return {
    id,
    fileName: `${id}.json`,
    json,
    enabled: true,
    editable: false,
    sourceIds: sources.map((s) => s.json),
    counts: { spell: Array.isArray(json.spell) ? json.spell.length : 0 },
    addedAt: 100,
  };
}

/** A file already on this device. */
function local(
  id: string,
  json: Json,
  { addedAt = 1, enabled = true }: { addedAt?: number; enabled?: boolean } = {},
): HomebrewFile {
  return { ...row(json, id), json, addedAt, enabled };
}

function official(entries: Partial<Record<EntityType, string[]>>, complete = true): OfficialIndex {
  const uids = new Map<EntityType, Set<string>>();
  const sources = new Set<string>();
  for (const [type, list] of Object.entries(entries) as [EntityType, string[]][]) {
    uids.set(type, new Set(list.map((u) => u.toLowerCase())));
    for (const u of list) sources.add(u.split('|')[1]?.toLowerCase() ?? '');
  }
  // For these types the clash key is the uid; feature types build theirs
  // through officialIndexFrom in their own tests.
  return { uids, clashKeys: uids, sources, complete };
}

const NO_OFFICIAL = official({});

function preview(
  json: Json,
  opts: {
    existing?: HomebrewFile[];
    official?: OfficialIndex | null;
    characters?: ReturnType<typeof newCharacterDoc>[];
    id?: string;
  } = {},
) {
  return previewHomebrewImport({
    row: row(json, opts.id),
    bytes: 1234,
    existing: opts.existing ?? [],
    official: opts.official === undefined ? NO_OFFICIAL : opts.official,
    characters: opts.characters ?? [],
  });
}

describe('previewHomebrewImport', () => {
  it('reports counts, size against the limit, and declared sources', () => {
    const p = preview({ _meta: meta(['HB']), spell: [spell('Zap', 'HB')] });
    expect(p.counts).toEqual({ spell: 1 });
    expect(p.bytes).toBe(1234);
    expect(p.limitBytes).toBe(IMPORT_LIMITS.maxImportBytes);
    expect(p.sources).toEqual([{ id: 'HB', full: 'HB Book' }]);
    expect(p.fileName).toBe('new-file.json');
  });

  it('names the file already here with the same content', () => {
    const json = { _meta: meta(['HB']), spell: [spell('Fire Bolt', 'PHB')] };
    const p = preview(json, {
      existing: [local('new-file', json, { addedAt: 7, enabled: false })],
      official: official({ spell: ['Fire Bolt|PHB'] }),
    });
    expect(p.duplicateOf).toEqual({
      id: 'new-file',
      fileName: 'new-file.json',
      addedAt: 7,
      enabled: false,
    });
    // Importing a duplicate writes nothing, so it clashes with nothing.
    expect(p.entityCollisions).toEqual([]);
    expect(p.sourceCollisions).toEqual([]);
  });

  it('lists files here that declare the same source with different content', () => {
    const p = preview(
      { _meta: meta(['HB']), spell: [spell('Zap', 'HB')] },
      {
        existing: [
          local(
            'older',
            { _meta: meta(['hb']), spell: [spell('Other', 'HB')] },
            { enabled: false },
          ),
          local('unrelated', { _meta: meta(['ELSE']) }),
        ],
      },
    );
    expect(p.duplicateOf).toBeUndefined();
    expect(p.sourceCollisions).toEqual([
      { sourceId: 'HB', files: [{ id: 'older', fileName: 'older.json', enabled: false }] },
    ]);
  });

  it('says official content wins a name and source clash', () => {
    const p = preview(
      { _meta: meta(['HB']), spell: [spell('Fire Bolt', 'PHB')] },
      { official: official({ spell: ['Fire Bolt|PHB'] }) },
    );
    expect(p.entityCollisions).toEqual([
      { type: 'spell', name: 'Fire Bolt', source: 'PHB', against: 'official', winner: 'official' },
    ]);
    expect(p.collisionTotal).toBe(1);
  });

  it('says the earliest enabled homebrew file wins a clash, and why', () => {
    const clash = { _meta: meta(['HB']), spell: [spell('Zap', 'HB')] };
    const p = preview(
      { _meta: meta(['HB2']), spell: [spell('Zap', 'HB')] },
      {
        existing: [
          // Sorted by id this would come first; by import time it is second.
          local('aaa', clash, { addedAt: 5 }),
          local('zzz', clash, { addedAt: 2 }),
          local('off', clash, { addedAt: 1, enabled: false }),
        ],
      },
    );
    expect(p.entityCollisions).toEqual([
      {
        type: 'spell',
        name: 'Zap',
        source: 'HB',
        against: { id: 'zzz', fileName: 'zzz.json' },
        winner: 'existing',
      },
    ]);
    expect(p.notes).toEqual([expect.stringContaining('"zzz.json" was imported first')]);
  });

  it('does not count the same name under another source as a clash', () => {
    const p = preview(
      { _meta: meta(['HB']), spell: [spell('Fire Bolt', 'HB')] },
      {
        official: official({ spell: ['Fire Bolt|PHB'] }),
        existing: [local('old', { _meta: meta(['X']), spell: [spell('Fire Bolt', 'X')] })],
      },
    );
    expect(p.entityCollisions).toEqual([]);
  });

  it('gives each declared dependency a status', () => {
    const json = {
      _meta: meta(['HB'], {
        dependencies: { spell: ['PHB', 'ON', 'HB'] },
        includes: { feat: ['OFF', 'GONE'] },
      }),
    };
    const existing = [
      local('on', { _meta: meta(['ON']) }),
      local('off', { _meta: meta(['OFF']) }, { enabled: false }),
    ];
    const done = preview(json, { existing, official: official({ spell: ['Fire Bolt|PHB'] }) });
    expect(done.dependencies).toEqual([
      { sourceId: 'PHB', status: 'official', via: 'meta' },
      { sourceId: 'ON', status: 'homebrew', via: 'meta' },
      { sourceId: 'OFF', status: 'disabled', via: 'meta' },
      { sourceId: 'GONE', status: 'missing', via: 'meta' },
    ]);

    // While game data is still arriving, "not found" is not yet "missing".
    const downloading = preview(json, {
      existing,
      official: official({ spell: ['Fire Bolt|PHB'] }, false),
    });
    expect(downloading.dependencies.find((d) => d.sourceId === 'GONE')?.status).toBe(
      'not-downloaded',
    );
    expect(preview(json, { official: null }).dependencies.map((d) => d.status)).toEqual([
      'not-downloaded',
      'not-downloaded',
      'not-downloaded',
      'not-downloaded',
    ]);
  });

  it('reads a bare dependency list and ignores malformed ones', () => {
    const p = preview({ _meta: meta(['HB'], { dependencies: ['A', 3], includes: 'B' }) });
    expect(p.dependencies.map((d) => d.sourceId)).toEqual(['A']);
  });

  it('reports a _copy target that is nowhere to be found', () => {
    const p = preview(
      {
        _meta: meta(['HB']),
        spell: [spell('Bigger Nope', 'HB', { _copy: { name: 'Nope', source: 'PHB' } })],
      },
      { official: official({ spell: ['Fire Bolt|PHB'] }) },
    );
    expect(p.copyIssues).toEqual([{ type: 'spell', name: 'Bigger Nope', target: 'Nope|PHB' }]);
  });

  it('counts a _copy of official or other homebrew content as a dependency, not an issue', () => {
    const p = preview(
      {
        _meta: meta(['HB']),
        spell: [
          spell('Hot Bolt', 'HB', { _copy: { name: 'Fire Bolt', source: 'PHB' } }),
          spell('Zip', 'HB', { _copy: { name: 'Zap', source: 'OTHER' } }),
          spell('Mine Too', 'HB', { _copy: { name: 'Hot Bolt', source: 'HB' } }),
        ],
      },
      {
        official: official({ spell: ['Fire Bolt|PHB'] }),
        existing: [local('other', { _meta: meta(['OTHER']), spell: [spell('Zap', 'OTHER')] })],
      },
    );
    expect(p.copyIssues).toEqual([]);
    expect(p.dependencies).toEqual([
      { sourceId: 'PHB', status: 'official', via: 'copy' },
      { sourceId: 'OTHER', status: 'homebrew', via: 'copy' },
    ]);
  });

  it('holds back on a _copy issue until game data has finished arriving', () => {
    const json = {
      _meta: meta(['HB']),
      spell: [
        spell('Later', 'HB', { _copy: { name: 'Unseen', source: 'XGE' } }),
        // Its own source: no download will ever supply it.
        spell('Never', 'HB', { _copy: { name: 'Absent', source: 'HB' } }),
      ],
    };
    const p = preview(json, { official: official({ spell: ['Fire Bolt|PHB'] }, false) });
    expect(p.copyIssues).toEqual([{ type: 'spell', name: 'Never', target: 'Absent|HB' }]);
    expect(p.dependencies).toEqual([{ sourceId: 'XGE', status: 'not-downloaded', via: 'copy' }]);
  });

  it('lists the characters that use one of its sources', () => {
    const user = newCharacterDoc('c1', 'Uses it', 'tag');
    user.spellcasting.wizard = { known: [{ name: 'Zap', source: 'hb' }], prepared: [] };
    const other = newCharacterDoc('c2', 'Does not', 'tag');
    other.race = { name: 'Elf', source: 'PHB' };
    const p = preview(
      { _meta: meta(['HB']), spell: [spell('Zap', 'HB')] },
      { characters: [user, other] },
    );
    expect(p.affectedCharacters).toEqual([{ id: 'c1', name: 'Uses it' }]);
  });

  it('skips a roster character it cannot read instead of failing the preview', () => {
    const user = newCharacterDoc('c1', 'Uses it', 'tag');
    user.homebrewDeps = ['HB'];
    const broken = newCharacterDoc('c2', 'Broken', 'tag');
    // A stored doc with a spellcasting entry missing its lists.
    (broken.spellcasting as Record<string, unknown>).wizard = {};
    (broken as unknown as { classes: unknown }).classes = undefined;
    const odd = { id: 'c3', name: 'Odd' } as unknown as ReturnType<typeof newCharacterDoc>;
    // Whatever else a reader trips on, one character is skipped, not the import.
    const throwing = newCharacterDoc('c4', 'Throws', 'tag');
    Object.defineProperty(throwing, 'race', {
      get() {
        throw new TypeError('unreadable');
      },
    });
    const p = preview(
      { _meta: meta(['HB']), spell: [spell('Zap', 'HB')] },
      { characters: [broken, odd, throwing, user] },
    );
    expect(p.affectedCharacters).toEqual([{ id: 'c1', name: 'Uses it' }]);
  });

  it('says how much official data it checked against', () => {
    const json = { _meta: meta(['HB']) };
    expect(preview(json).officialCoverage).toBe('complete');
    expect(preview(json, { official: official({}, false) }).officialCoverage).toBe('partial');
    expect(preview(json, { official: null }).officialCoverage).toBe('unavailable');
  });

  it('names the turned-off file that holds a copy target', () => {
    const off = local(
      'off',
      { _meta: meta(['OFF']), spell: [spell('Base', 'OFF')] },
      {
        enabled: false,
      },
    );
    const p = preview(
      {
        _meta: meta(['HB']),
        spell: [spell('Child', 'HB', { _copy: { name: 'Base', source: 'OFF' } })],
      },
      { existing: [off] },
    );
    expect(p.copyIssues).toEqual([
      {
        type: 'spell',
        name: 'Child',
        target: 'Base|OFF',
        disabledIn: { id: 'off', fileName: 'off.json' },
      },
    ]);
  });

  it('notes when official content could not be checked, and claims no official clash', () => {
    const p = preview(
      { _meta: meta(['HB']), spell: [spell('Fire Bolt', 'PHB')] },
      { official: null },
    );
    expect(p.entityCollisions).toEqual([]);
    expect(p.notes).toEqual([expect.stringContaining('were not checked')]);
    const partial = preview(
      { _meta: meta(['HB']) },
      { official: official({ spell: ['Fire Bolt|PHB'] }, false) },
    );
    expect(partial.notes).toEqual([
      expect.stringContaining('Not all game data is on this device yet'),
    ]);
  });

  it('caps the clash list but keeps the real total', () => {
    const names = Array.from({ length: MAX_LISTED_COLLISIONS + 10 }, (_, i) => `Spell ${i}`);
    const p = preview(
      { _meta: meta(['HB']), spell: names.map((n) => spell(n, 'PHB')) },
      { official: official({ spell: names.map((n) => `${n}|PHB`) }) },
    );
    expect(p.entityCollisions).toHaveLength(MAX_LISTED_COLLISIONS);
    expect(p.collisionTotal).toBe(MAX_LISTED_COLLISIONS + 10);
  });
});

describe('previewHomebrewImport for a file of a collection here (ADR-002, D4)', () => {
  const key = 'file:hb|brew';
  const keyed = (f: HomebrewFile): HomebrewFile => ({ ...f, key });
  const incoming = { _meta: meta(['HB']), spell: [spell('Zap', 'HB'), spell('Fizz', 'HB')] };

  function update(existing: HomebrewFile[]) {
    return previewHomebrewImport({
      row: { ...row(incoming), key },
      bytes: 10,
      existing,
      official: NO_OFFICIAL,
      characters: [],
    });
  }

  it('says it updates that one, and clashes with none of its copies', () => {
    const old = keyed(local('old', { _meta: meta(['HB']), spell: [spell('Zap', 'HB')] }));
    const twin = keyed(
      local('twin', { _meta: meta(['HB']), spell: [] }, { addedAt: 3, enabled: false }),
    );
    const p = update([old, twin]);
    expect(p.updates).toEqual({
      id: 'old',
      fileName: 'old.json',
      addedAt: 1,
      enabled: true,
      copies: 2,
    });
    expect(p.duplicateOf).toBeUndefined();
    expect(p.sourceCollisions).toEqual([]);
    expect(p.entityCollisions).toEqual([]);
  });

  it('keeps the old one’s place, so only a file imported before it wins a clash', () => {
    const old = keyed(local('old', { _meta: meta(['HB']), spell: [] }, { addedAt: 5 }));
    const before = local(
      'before',
      { _meta: meta(['B']), spell: [spell('Zap', 'HB')] },
      { addedAt: 2 },
    );
    const after = local(
      'after',
      { _meta: meta(['A']), spell: [spell('Fizz', 'HB')] },
      { addedAt: 9 },
    );
    const p = update([old, before, after]);
    expect(
      p.entityCollisions.map((c) => [c.name, c.against === 'official' ? '' : c.against.id]),
    ).toEqual([['Zap', 'before']]);
  });

  it('updates a copy with no stamp under its file with a stamped one, never another stamp', () => {
    const stamped = (existing: HomebrewFile[]) =>
      previewHomebrewImport({
        row: { ...row(incoming), key: 'made:osk' },
        bytes: 10,
        existing,
        official: NO_OFFICIAL,
        characters: [],
      }).updates?.id;
    const old = { ...local('old', { _meta: meta(['HB']), spell: [] }), key: 'file:hb|new-file' };
    expect(stamped([old])).toBe('old');
    expect(stamped([{ ...old, key: 'made:bram' }])).toBeUndefined();
  });

  it('never updates a file the player owns, or one under another key', () => {
    const mine = { ...local('mine', { _meta: meta(['HB']), spell: [] }), editable: true, key };
    const other = { ...local('other', { _meta: meta(['HB']), spell: [] }), key: 'file:hb|other' };
    expect(update([mine, other]).updates).toBeUndefined();
  });
});

describe('entryChanges', () => {
  it('names each field that differs, short values with what they were and are', () => {
    expect(
      entryChanges(
        { name: 'Aid', source: 'XPHB', level: 2, range: { type: 'point' }, ritual: false },
        { name: 'Aid', source: 'TBL', level: 3, range: { type: 'self' }, ritual: true },
      ),
    ).toBe('Differs in level (2 to 3), ritual (no to yes) and range.');
    // Text is named, never quoted: a school's code reads as nothing.
    expect(entryChanges({ school: 'V' }, { school: 'EN' })).toBe('Differs in school.');
    // Prose is said once, last; a field only one side has is named alone.
    expect(
      entryChanges(
        { name: 'X', entries: ['a'], entriesHigherLevel: ['b'] },
        { name: 'X', entries: ['c'], duration: [{ type: 'instant' }] },
      ),
    ).toBe('Differs in duration and its text.');
  });

  it('reads objects as the same whatever their key order, and caps the list', () => {
    expect(entryChanges({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } })).toBe(
      'The same as the one here.',
    );
    const was = { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1 };
    const now = { a: 2, b: 2, c: 2, d: 2, e: 2, f: 2, g: 2 };
    expect(entryChanges(was, now)).toBe(
      'Differs in a (1 to 2), b (1 to 2), c (1 to 2), d (1 to 2), e (1 to 2) and 2 more.',
    );
  });

  it('says nothing of a version written as a copy, or of where an entry is printed', () => {
    expect(entryChanges({ name: 'X' }, { _copy: { name: 'X' }, level: 3 })).toBeUndefined();
    expect(entryChanges({ page: 3, srd: true }, { page: 9 })).toBe('The same as the one here.');
    // Nor of what the app or the data adds to index it, which a pack never writes.
    expect(
      entryChanges(
        { bookEdition: 'one', miscTags: ['SGT'], damageInflict: ['fire'], savingThrow: ['dex'] },
        { entries: [] },
      ),
    ).toBe('Differs in its text.');
  });
});

describe('officialIndexFrom', () => {
  it('takes official entities and sources across every type, never merged homebrew', () => {
    const reg = new EntityRegistry();
    reg.addAll('spell', [spell('Fire Bolt', 'PHB')]);
    // A type the source filter does not count still names an official source.
    reg.addAll('classFeature', [{ name: 'Feature', source: 'XGE' }]);
    mergeHomebrew(reg, new Map([['hb', { spell: [spell('Zap', 'HB')] }]]));

    const index = officialIndexFrom(reg);
    expect([...(index.uids.get('spell') ?? [])]).toEqual(['fire bolt|phb']);
    expect([...index.sources].sort()).toEqual(['phb', 'xge']);
    expect(index.complete).toBe(true);
    expect(officialIndexFrom(reg, { complete: false }).complete).toBe(false);
  });

  it("finds the book's entry of an identity, the first in list order", () => {
    const reg = new EntityRegistry();
    reg.addAll('spell', [spell('Aid', 'XPHB', { level: 2 }), spell('Aid', 'XPHB', { level: 9 })]);
    mergeHomebrew(reg, new Map([['hb', { spell: [spell('Zap', 'HB')] }]]));
    const index = officialIndexFrom(reg);
    expect(index.entry?.('spell', 'aid|xphb')?.level).toBe(2);
    // Homebrew is never the book's.
    expect(index.entry?.('spell', 'zap|hb')).toBeUndefined();
  });

  it("finds the book's own entry where a change here stands in its place", () => {
    const reg = new EntityRegistry();
    const aid = spell('Aid', 'XPHB', { level: 2, entries: ['Hope.'] });
    reg.addAll('spell', [aid]);
    const changes = {
      _meta: { sources: [{ json: 'MyChanges', full: 'Changes to the books' }] },
      spell: [writeChange('spell', aid, { ...aid, level: 3 })],
    };
    mergeHomebrew(reg, new Map([['changes', changes]]), new Map(), new Set(['changes']));
    // The list holds the changed one; the index gives the book's below it.
    expect(reg.get('spell', 'Aid', 'XPHB')?.level).toBe(3);
    expect(officialIndexFrom(reg).entry?.('spell', 'aid|xphb')?.level).toBe(2);
  });

  it('builds once per registry instance', () => {
    const reg = new EntityRegistry();
    reg.addAll('spell', [spell('Fire Bolt', 'PHB')]);
    const first = officialIndexFrom(reg);
    const again = officialIndexFrom(reg, { complete: false });
    expect(again.uids).toBe(first.uids);
    expect(again.complete).toBe(false);
    const other = new EntityRegistry();
    other.addAll('spell', [spell('Fire Bolt', 'PHB')]);
    expect(officialIndexFrom(other).uids).not.toBe(first.uids);
  });
});

describe('class and subclass feature clashes', () => {
  const feature = (extra: Json) => ({ name: 'Rage', source: 'HB', level: 1, ...extra });
  const sub = (extra: Json) => ({
    name: 'Frenzy',
    source: 'HB',
    className: 'Barbarian',
    subclassShortName: 'Berserker',
    subclassSource: 'PHB',
    level: 3,
    ...extra,
  });

  it('keys them the way the class builder looks them up', () => {
    const cf = feature({ className: 'Barbarian', classSource: 'PHB' });
    expect(clashKey('classFeature', cf)).toBe('rage|barbarian|phb|1|hb');
    expect(clashKey('classFeature', { name: 'Rage', source: 'HB' })).toBeUndefined();
    // The builder does not look at a subclass feature's own source.
    expect(clashKey('subclassFeature', sub({ source: 'OTHER' }))).toBe(
      'frenzy|barbarian|berserker|phb|3',
    );
    expect(clashKey('subclassFeature', sub({ level: undefined }))).toBeUndefined();
    expect(clashKey('spell', spell('Zap', 'HB'))).toBe('zap|hb');
  });

  it('reports only features the engine would actually confuse', () => {
    const reg = new EntityRegistry();
    reg.addAll('classFeature', [feature({ className: 'Barbarian', classSource: 'PHB' })]);
    reg.addAll('subclassFeature', [sub({})]);
    const p = preview(
      {
        _meta: meta(['HB']),
        classFeature: [
          // Same name and source, another class or level: no clash.
          feature({ className: 'Fighter', classSource: 'PHB' }),
          feature({ className: 'Barbarian', classSource: 'PHB', level: 2 }),
          // Every field the builder matches on: a clash.
          feature({ className: 'Barbarian', classSource: 'PHB' }),
        ],
        subclassFeature: [sub({ subclassShortName: 'Zealot' }), sub({ source: 'ELSE' })],
      },
      { official: officialIndexFrom(reg) },
    );
    expect(p.entityCollisions.map((c) => [c.type, c.name, c.source])).toEqual([
      ['classFeature', 'Rage', 'HB'],
      ['subclassFeature', 'Frenzy', 'ELSE'],
    ]);
  });

  it('keys clashes with homebrew here the same way', () => {
    const p = preview(
      {
        _meta: meta(['HB2']),
        classFeature: [feature({ className: 'Fighter', classSource: 'PHB' })],
      },
      {
        existing: [
          local('older', {
            _meta: meta(['HB']),
            classFeature: [feature({ className: 'Barbarian', classSource: 'PHB' })],
          }),
        ],
      },
    );
    expect(p.entityCollisions).toEqual([]);
    expect(p.notes).toEqual([]);
  });
});

describe('clashes with a turned-off file', () => {
  it('says the older file wins again if it is turned back on', () => {
    const p = preview(
      { _meta: meta(['HB']), spell: [spell('Zap', 'HB'), spell('Other', 'HB')] },
      {
        existing: [
          local('off', { _meta: meta(['HB']), spell: [spell('Zap', 'HB')] }, { enabled: false }),
        ],
      },
    );
    expect(p.entityCollisions).toEqual([]);
    expect(p.disabledClashes).toEqual([
      { type: 'spell', name: 'Zap', source: 'HB', against: { id: 'off', fileName: 'off.json' } },
    ]);
    expect(p.disabledClashTotal).toBe(1);
    expect(p.notes).toEqual([expect.stringContaining('wins again if it is turned back on')]);
  });

  it('caps the list but keeps the real total', () => {
    const names = Array.from({ length: MAX_LISTED_COLLISIONS + 5 }, (_, i) => `Spell ${i}`);
    const spells = names.map((n) => spell(n, 'HB'));
    const p = preview(
      { _meta: meta(['HB']), spell: spells },
      { existing: [local('off', { _meta: meta(['HB']), spell: spells }, { enabled: false })] },
    );
    expect(p.disabledClashes).toHaveLength(MAX_LISTED_COLLISIONS);
    expect(p.disabledClashTotal).toBe(MAX_LISTED_COLLISIONS + 5);
  });
});

describe('copies elsewhere that this file fixes', () => {
  const child = spell('Child', 'AAA', { _copy: { name: 'Base', source: 'BBB' } });

  it('names enabled files whose broken _copy it supplies', () => {
    const p = preview(
      { _meta: meta(['BBB']), spell: [spell('Base', 'BBB', { level: 3 })] },
      {
        existing: [
          local('needs-it', { _meta: meta(['AAA']), spell: [child] }),
          local('off', { _meta: meta(['CCC']), spell: [child] }, { enabled: false }),
          local('unrelated', { _meta: meta(['DDD']), spell: [spell('Nope', 'DDD')] }),
          // Broken too, but for a target this file does not supply.
          local('other-gap', {
            _meta: meta(['EEE']),
            spell: [spell('Gap', 'EEE', { _copy: { name: 'Elsewhere', source: 'ZZZ' } })],
          }),
        ],
      },
    );
    expect(p.satisfiesCopies).toEqual([
      {
        file: { id: 'needs-it', fileName: 'needs-it.json' },
        entries: [{ type: 'spell', name: 'Child', target: 'Base|BBB' }],
      },
    ]);
  });

  it('claims nothing a copy already finds elsewhere', () => {
    const base = spell('Base', 'BBB', { level: 3 });
    const json = { _meta: meta(['BBB']), spell: [base] };
    // Found in its own file.
    expect(
      preview(json, {
        existing: [local('self', { _meta: meta(['AAA']), spell: [child, base] })],
      }).satisfiesCopies,
    ).toEqual([]);
    // Found in official data.
    expect(
      preview(json, {
        existing: [local('a', { _meta: meta(['AAA']), spell: [child] })],
        official: official({ spell: ['Base|BBB'] }),
      }).satisfiesCopies,
    ).toEqual([]);
    // Found in another enabled file.
    expect(
      preview(json, {
        existing: [local('a', { _meta: meta(['AAA']), spell: [child] }), local('b', json)],
        id: 'new-version',
      }).satisfiesCopies,
    ).toEqual([]);
    // An exact duplicate writes nothing, so it fixes nothing.
    expect(
      preview(json, {
        existing: [local('a', { _meta: meta(['AAA']), spell: [child] }), local('new-file', json)],
      }).satisfiesCopies,
    ).toEqual([]);
  });
});

describe('collision copy', () => {
  it('names the version a character gets', () => {
    expect(
      describeCollision({
        type: 'spell',
        name: 'Fire Bolt',
        source: 'PHB',
        against: 'official',
        winner: 'official',
      }),
    ).toContain('gets the official version');
    expect(
      describeCollision({
        type: 'spell',
        name: 'Zap',
        source: 'HB',
        against: { id: 'x', fileName: 'old.json' },
        winner: 'existing',
      }),
    ).toContain('"old.json", which was imported first');
    expect(WINNER_POLICY).toContain('the one imported first wins');
  });
});

describe('previewHomebrewImport for a file stored a book at a time', () => {
  /** One book's row, as `prepareBooks` makes it. */
  function bookRow(
    id: string,
    source: string,
    names: string[],
    fileName = 'all.xml',
  ): HomebrewFile {
    const json = { _meta: meta([source]), spell: names.map((n) => spell(n, source)) };
    return { ...row(json, id), fileName, book: `${source} Book`, json };
  }
  const EMB = bookRow('emb-2', 'EMB', ['Ember Lance']);
  const ASH = bookRow('ash-2', 'ASH', ['Ash Bolt', 'Ash Veil']);
  const NEW = bookRow('new-2', 'NEW', ['Zap']);
  const whole = row(
    {
      _meta: meta(['EMB', 'ASH', 'NEW']),
      spell: [
        spell('Ember Lance', 'EMB'),
        spell('Ash Bolt', 'ASH'),
        spell('Ash Veil', 'ASH'),
        spell('Zap', 'NEW'),
      ],
    },
    '',
  );

  function previewBooks(
    existing: HomebrewFile[],
    characters: ReturnType<typeof newCharacterDoc>[] = [],
  ) {
    return previewHomebrewImport({
      row: { ...whole, fileName: 'all.xml' },
      books: [EMB, ASH, NEW],
      bytes: 1234,
      limitBytes: IMPORT_LIMITS.maxXmlImportBytes,
      existing,
      official: NO_OFFICIAL,
      characters,
    });
  }

  it('says what each book would do, and checks no clash against its own older copy', () => {
    const p = previewBooks([
      // The same Ember Codex, already here.
      { ...EMB, addedAt: 3 },
      // An older Ashen Tome from this file (a second download of it), which this one replaces.
      { ...bookRow('ash-1', 'ASH', ['Ash Bolt'], 'All (1).xml'), addedAt: 2 },
      // Another file entirely, which does clash.
      local('other', { _meta: meta(['OTH']), spell: [spell('Zap', 'NEW')] }),
    ]);
    expect(p.books).toEqual([
      { id: 'emb-2', full: 'EMB Book', counts: { spell: 1 }, status: 'same' },
      {
        id: 'ash-2',
        full: 'ASH Book',
        counts: { spell: 2 },
        status: 'replaces',
        replacesFrom: 'All (1).xml',
      },
      { id: 'new-2', full: 'NEW Book', counts: { spell: 1 }, status: 'new' },
    ]);
    expect(p.limitBytes).toBe(IMPORT_LIMITS.maxXmlImportBytes);
    expect(p.duplicateOf).toBeUndefined();
    expect(p.sourceCollisions).toEqual([]);
    expect(p.entityCollisions.map((c) => [c.name, c.against])).toEqual([
      ['Zap', { id: 'other', fileName: 'other.json' }],
    ]);
  });

  it('keeps another file`s copy of a book, names it under the book, and notes its clashes once', () => {
    const p = previewBooks([
      { ...bookRow('ash-5e', 'ASH', ['Ash Bolt', 'Ash Storm'], 'five.xml'), addedAt: 1 },
      { ...bookRow('new-5e', 'NEW', ['Zap'], 'five.xml'), addedAt: 1 },
    ]);
    expect(p.books?.map((b) => [b.full, b.status, b.alsoIn])).toEqual([
      ['EMB Book', 'new', undefined],
      ['ASH Book', 'new', ['five.xml']],
      ['NEW Book', 'new', ['five.xml']],
    ]);
    // Named under the book, not again as a file declaring the same source.
    expect(p.sourceCollisions).toEqual([]);
    expect(p.entityCollisions.map((c) => c.name)).toEqual(['Ash Bolt', 'Zap']);
    expect(p.notes.filter((n) => n.includes('five.xml'))).toEqual([
      expect.stringContaining('match entries in "five.xml"'),
    ]);
  });

  it('names a clash with a stored book by the book and the file it came from', () => {
    const p = previewBooks([
      { ...bookRow('ash-5e', 'ASH', ['Ash Bolt'], 'five.xml'), addedAt: 1 },
      { ...bookRow('off-5e', 'NEW', ['Zap'], 'five.xml'), addedAt: 1, enabled: false },
    ]);
    const [clash] = p.entityCollisions;
    expect(clash?.against).toEqual({ id: 'ash-5e', fileName: 'ASH Book', file: 'five.xml' });
    expect(clash === undefined ? '' : describeCollision(clash)).toBe(
      'Ash Bolt (ASH) is also in ASH Book, from "five.xml", which was imported first, so a character that picks it gets that version.',
    );
    expect(p.disabledClashes.map((c) => whereIn(c.against))).toEqual(['NEW Book, from "five.xml"']);
    // A file kept whole is named as a file, as before.
    expect(whereIn({ id: 'x', fileName: 'brew.json' })).toBe('"brew.json"');
  });

  it('names only files ahead of a book that keeps its own copy`s place', () => {
    // This file's ASH copy came first (1), five.xml's copy later (3). The new
    // ASH replaces the old copy and keeps its place, so five.xml does not win.
    const later = (enabled: boolean) =>
      previewBooks([
        { ...bookRow('ash-1', 'ASH', ['Ash Bolt']), addedAt: 1 },
        { ...bookRow('ash-5e', 'ASH', ['Ash Bolt', 'Ash Veil'], 'five.xml'), addedAt: 3, enabled },
      ]);
    expect(later(true).books?.find((b) => b.full === 'ASH Book')?.status).toBe('replaces');
    expect(later(true).entityCollisions).toEqual([]);
    expect(later(true).notes.filter((n) => n.includes('five.xml'))).toEqual([]);
    expect(later(false).disabledClashes).toEqual([]);
    // Imported before this file's copy, five.xml wins, on or off.
    const earlier = (enabled: boolean) =>
      previewBooks([
        { ...bookRow('ash-1', 'ASH', ['Ash Bolt']), addedAt: 3 },
        { ...bookRow('ash-5e', 'ASH', ['Ash Bolt', 'Ash Veil'], 'five.xml'), addedAt: 1, enabled },
      ]);
    expect(earlier(true).entityCollisions.map((c) => c.name)).toEqual(['Ash Bolt', 'Ash Veil']);
    expect(earlier(false).disabledClashes.map((c) => c.name)).toEqual(['Ash Bolt', 'Ash Veil']);
  });

  it('replaces the file imported whole before it was stored a book at a time', () => {
    // Under the source named after the file, as the file's own book (of the
    // entries citing none) is now: the same entries, so they would clash.
    const legacy = (id: string, fileName: string): HomebrewFile => {
      const json = {
        _meta: {
          ...meta(['NEW']),
          convertedFrom: { format: 'fc5-compendium', fileName },
        },
        spell: [spell('Zap', 'NEW'), spell('Gone', 'NEW')],
      };
      return { ...row(json, id), fileName, json };
    };
    // Aria picked an entry the file no longer brings under that source; Brin
    // picked one it brings again, so Brin loses nothing.
    const aria = newCharacterDoc('hero', 'Aria', 'tag');
    aria.feats = [{ ref: { name: 'Gone', source: 'NEW' }, instanceId: 'f1' }];
    const brin = newCharacterDoc('kept', 'Brin', 'tag');
    brin.feats = [{ ref: { name: 'Zap', source: 'NEW' }, instanceId: 'f1' }];
    const p = previewBooks([legacy('old', 'all.xml')], [aria, brin]);
    expect(p.replacesOldImport).toEqual([{ id: 'old', fileName: 'all.xml', sourceIds: ['NEW'] }]);
    expect(p.oldImportCharacters).toEqual([{ id: 'hero', name: 'Aria' }]);
    // What it replaces is no file to clash with.
    expect(p.entityCollisions).toEqual([]);
    expect(p.sourceCollisions).toEqual([]);
    // Another file stored whole is not this one.
    const other = previewBooks([legacy('elsewhere', 'other.xml')]);
    expect(other.replacesOldImport).toBeUndefined();
    expect(other.entityCollisions.map((c) => c.name)).toEqual(['Zap']);
  });

  it('is already here when every book is', () => {
    const p = previewBooks([
      { ...EMB, addedAt: 5 },
      { ...ASH, addedAt: 4, enabled: false },
      { ...NEW, addedAt: 6 },
    ]);
    expect(p.duplicateOf).toEqual({
      id: 'emb-2',
      fileName: 'all.xml',
      addedAt: 4,
      enabled: false,
      booksOff: 1,
    });
    expect(p.books?.every((b) => b.status === 'same')).toBe(true);
  });

  it('names a stored book by its book, with the file it came from beside it', () => {
    const p = preview(
      { _meta: meta(['HB']), spell: [spell('Ember Lance', 'HB')] },
      {
        existing: [bookRow('emb', 'EMB', ['Ember Lance'])].map((b) => ({
          ...b,
          json: { ...b.json, spell: [spell('Ember Lance', 'HB')] },
        })),
      },
    );
    expect(p.entityCollisions[0]?.against).toEqual({
      id: 'emb',
      fileName: 'EMB Book',
      file: 'all.xml',
    });
  });
});

describe('a rule pack’s replaces in the preview (ADR-002, D2)', () => {
  const ref = (name: string, source: string, extra: Json = {}) => ({
    type: 'spell',
    name,
    source,
    ...extra,
  });
  /** A pack, its `replaces` and its content. */
  const pack = (replaces: unknown, spells: Json[] = []): Json => ({
    _meta: {
      sources: [{ json: 'TBL', full: 'Our Table' }],
      castGuidance: { v: 1, replaces },
    },
    spell: spells,
  });
  const book = (complete = true) => official({ spell: ['Aid|XPHB', 'Fireball|XPHB'] }, complete);
  const grimoire = () => local('twg', { _meta: meta(['TWG']), spell: [spell('Riptide', 'TWG')] });
  const everyone = { characters: [], appDefault: true };

  it('names each entry once, as the merge reads the list', () => {
    const read = packReplaces(
      pack(
        [
          ref('Aid', 'XPHB'),
          ref('aid', 'xphb'),
          ref('Riptide', 'TWG'),
          { type: 'spell', name: 'No source' },
          { type: 'monster', name: 'Goblin', source: 'XMM' },
          'Fireball',
        ],
        [
          { name: 'Aid', source: 'XPHB', level: 3 },
          // Its identity is what it leaves to its copy.
          { _copy: { name: 'Riptide', source: 'TWG' }, level: 2 },
        ],
      ),
    );
    expect(read?.entries.map((r) => [r.words, r.inPack])).toEqual([
      ['Aid (spell, XPHB)', true],
      ['Riptide (spell, TWG)', true],
    ]);
    expect(read).toMatchObject({ over: 0, unread: 3 });
    expect(read).not.toHaveProperty('notAList');
    expect(packReplaces(pack('Aid'))).toMatchObject({ entries: [], unread: 0, notAList: true });
    expect(packReplaces({ _meta: { sources: [{ json: 'HB' }] } })).toBeUndefined();
  });

  it('names a feature by its class and level', () => {
    const read = packReplaces(
      pack([
        {
          type: 'classFeature',
          name: 'Rage',
          source: 'XPHB',
          className: 'Barbarian',
          classSource: 'XPHB',
          level: 1,
        },
      ]),
    );
    expect(read?.entries[0]?.words).toBe('Rage (class feature, XPHB, Barbarian, level 1)');
  });

  it('reads no more than a pack may name, and says what it left', () => {
    const many = Array.from({ length: 502 }, (_, i) => ref(`Spell ${i}`, 'XPHB'));
    const review = packReview(pack(many));
    expect(review?.replaces?.entries).toHaveLength(500);
    expect(review?.problems).toContain(
      'It names 2 more entries to replace than a pack may (500), so those replace nothing',
    );
    expect(packReview(pack('Aid'))?.problems).toContain(
      'Its "replaces" is not a list of entries, so it replaces nothing',
    );
    expect(packReview(pack([{ type: 'spell' }, { name: 'x' }]))?.problems).toContain(
      '2 entries it names to replace have no type, name or source, so they replace nothing',
    );
  });

  it('counts a pack that only replaces entries as holding them', () => {
    const review = packReview(
      pack([ref('Aid', 'XPHB'), ref('Fireball', 'XPHB')], [spell('Aid', 'XPHB')]),
    );
    expect(review?.holds).toBe('2 changed entries');
    expect(review?.changes.map((r) => r.value)).toEqual([
      "The pack's own version, in place of the one here, for the characters it applies to",
      'Not in this pack, so it replaces nothing',
    ]);
  });

  it('says what each lands over here: the book’s, a collection’s, or nothing yet', () => {
    const json = pack(
      [
        ref('Aid', 'XPHB'),
        ref('Riptide', 'TWG'),
        ref('Moonbeam', 'XPHB'),
        ref('Ice Knife', 'XPHB'),
      ],
      [spell('Aid', 'XPHB'), spell('Riptide', 'TWG'), spell('Moonbeam', 'XPHB')],
    );
    const lands = (opts: Parameters<typeof preview>[1]) =>
      (preview(json, opts).pack?.changes ?? []).map((r) => r.value);
    expect(lands({ official: book(), existing: [grimoire()] })).toEqual([
      "The pack's own version, in place of the book's, for the characters it applies to",
      'The pack\'s own version, in place of the one in "twg.json", for the characters it applies to',
      'Nothing here has it, so it replaces nothing until it is here',
      'Not in this pack, so it replaces nothing',
    ]);
    // Before every book is here, an entry found nowhere may be in one still to come.
    expect(lands({ official: book(false), existing: [] })[2]).toBe(
      "Not found yet: not all game data is on this device, so it may replace the book's once the rest is",
    );
    // A collection that is off, another pack's own change, or the player's
    // Changes to the books is nothing to land over: none of them is content.
    const off = { ...grimoire(), enabled: false };
    const otherPack = local('other', pack([ref('Riptide', 'TWG')], [spell('Riptide', 'TWG')]));
    const mine: HomebrewFile = {
      ...local('mine', { _meta: meta(['MyChanges']), spell: [spell('Riptide', 'TWG')] }),
      role: 'changes',
    };
    for (const existing of [[off], [otherPack], [mine]]) {
      expect(lands({ official: book(), existing })[1]).toBe(
        'Nothing here has it, so it replaces nothing until it is here',
      );
    }
  });

  it('says under each how its version differs from the one it replaces here', () => {
    const json = pack(
      [ref('Aid', 'XPHB'), ref('Riptide', 'TWG'), ref('Moonbeam', 'XPHB')],
      [
        spell('Aid', 'XPHB', { level: 3, entries: ['Hope, and more of it.'] }),
        spell('Riptide', 'TWG'),
        { _copy: { name: 'Moonbeam', source: 'XPHB' }, level: 3 },
      ],
    );
    const reg = new EntityRegistry();
    reg.addAll('spell', [
      spell('Aid', 'XPHB', { level: 2, entries: ['Hope.'], page: 239 }),
      spell('Moonbeam', 'XPHB', { level: 2 }),
    ]);
    const details = preview(json, {
      official: officialIndexFrom(reg),
      existing: [grimoire()],
    }).pack?.changes.map((r) => r.detail);
    expect(details).toEqual([
      // The book's, found through the index: its page is where it is printed, not a change.
      'Differs in level (2 to 3) and its text.',
      // The collection's: the same in every field.
      'The same as the one here.',
      // A copy's fields are known only once merged.
      undefined,
    ]);
    // Nor of a collection's entry that is a copy: its fields are known only once merged.
    const copied = local('cp', {
      _meta: meta(['TWG']),
      spell: [{ name: 'Riptide', source: 'TWG', _copy: { name: 'Tide', source: 'TWG' } }],
    });
    const below = preview(json, { official: officialIndexFrom(reg), existing: [copied] }).pack
      ?.changes[1];
    expect(below?.value).toContain('in place of the one in "cp.json"');
    expect(below?.detail).toBeUndefined();
    // An index built without the book's entries says nothing under the row.
    expect(
      preview(json, { official: book(), existing: [grimoire()] }).pack?.changes[0]?.detail,
    ).toBeUndefined();
  });

  it('claims no clash for an entry it replaces, and keeps the rest’s', () => {
    const p = preview(
      pack(
        [ref('Aid', 'XPHB'), ref('Riptide', 'TWG')],
        [spell('Aid', 'XPHB'), spell('Riptide', 'TWG'), spell('Fireball', 'XPHB')],
      ),
      { official: book(), existing: [grimoire()] },
    );
    expect(p.entityCollisions.map((c) => `${c.name}|${c.source}`)).toEqual(['Fireball|XPHB']);
  });

  it('agrees with the merge on what each replaced entry stands over', () => {
    const release = new Map<string, unknown>([
      [
        'spells/spells-xphb.json',
        {
          spell: [
            { name: 'Aid', source: 'XPHB', level: 2, entries: ['Five.'] },
            { name: 'Fireball', source: 'XPHB', level: 3, entries: ['Boom.'] },
          ],
        },
      ],
    ]);
    const twg = grimoire();
    // Another pack here, ahead of the grimoire, lists Riptide: its Riptide is
    // no content to stand on, so the grimoire's is what the new pack's is over.
    const other = local(
      'other',
      pack([ref('Riptide', 'TWG')], [spell('Riptide', 'TWG', { level: 9 })]),
      { addedAt: 0 },
    );
    const json = pack(
      [ref('Aid', 'XPHB'), ref('Riptide', 'TWG'), ref('Moonbeam', 'XPHB')],
      [
        { name: 'Aid', source: 'XPHB', _copy: { name: 'Aid', source: 'XPHB', _mod: {} } },
        { name: 'Riptide', source: 'TWG', level: 5, entries: ['Ours.'] },
        spell('Moonbeam', 'XPHB'),
      ],
    );
    // What the device has before: the books, the grimoire and the other pack.
    const before = normalizeDataset(release);
    mergeHomebrew(
      before,
      new Map([
        [other.id, other.json],
        [twg.id, twg.json],
      ]),
    );
    const p = preview(json, { official: officialIndexFrom(before), existing: [other, twg] });
    // What it has after, the new pack on for every character.
    const after = normalizeDataset(release);
    mergeHomebrew(
      after,
      new Map([
        [other.id, other.json],
        [twg.id, twg.json],
        ['new-file', json],
      ]),
      new Map([['new-file', { appliesTo: everyone }]]),
    );
    const placed = after
      .changedEntries()
      .filter((c) => c.layers.some((l) => l.from.fileId === 'new-file'))
      .map((c) => [identityKey(c.type, c.base), c.base.source])
      .sort();
    expect(placed).toEqual([
      ['aid|xphb', 'XPHB'],
      ['riptide|twg', 'TWG'],
    ]);
    const read = packReplaces(json)?.entries ?? [];
    const rows = (p.pack?.changes ?? []).map((r) => r.value);
    expect(rows).toEqual([
      replacedRow(read[0] as PackReplacement, { kind: 'book' }).value,
      replacedRow(read[1] as PackReplacement, { kind: 'collection', fileName: 'twg.json' }).value,
      'Nothing here has it, so it replaces nothing until it is here',
    ]);
    // Each entry the preview says it lands over is one the merge changed, and no other.
    const landsOver = read.filter((_, i) => rows[i]?.startsWith("The pack's own version"));
    expect(landsOver.map((r) => r.identity).sort()).toEqual(placed.map(([id]) => id));
  });

  it('names them on an Update of a pack that keeps its Apply to', () => {
    const key = 'file:tbl|our table';
    const old: HomebrewFile = {
      ...local('tbl-old', pack([ref('Aid', 'XPHB')], [spell('Aid', 'XPHB')])),
      key,
      pack: { appliesTo: everyone },
    };
    const json = pack(
      [ref('Aid', 'XPHB'), ref('Fireball', 'XPHB')],
      [spell('Aid', 'XPHB'), spell('Fireball', 'XPHB')],
    );
    const p = previewHomebrewImport({
      row: { ...row(json), key },
      bytes: 10,
      existing: [old],
      official: book(),
      characters: [],
    });
    expect(p.updates?.id).toBe('tbl-old');
    expect(p.packIn?.appliesTo).toEqual(everyone);
    expect(p.pack?.changes.map((r) => [r.key, r.value])).toEqual([
      [
        'Aid (spell, XPHB)',
        "The pack's own version, in place of the book's, for the characters it applies to",
      ],
      [
        'Fireball (spell, XPHB)',
        "The pack's own version, in place of the book's, for the characters it applies to",
      ],
    ]);
    expect(p.entityCollisions).toEqual([]);
  });
});
