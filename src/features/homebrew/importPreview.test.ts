import { describe, expect, it } from 'vitest';
import { EntityRegistry, type EntityType, mergeHomebrew } from '@/data5e/normalize';
import type { HomebrewFileRow } from '@/db/db';
import type { HomebrewFile } from '@/db/homebrewRepo';
import { newCharacterDoc } from '@/engine/types';
import { IMPORT_LIMITS } from '@/lib/guards';
import {
  clashKey,
  describeCollision,
  MAX_LISTED_COLLISIONS,
  type OfficialIndex,
  officialIndexFrom,
  previewHomebrewImport,
  WINNER_POLICY,
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
    expect(partial.notes).toEqual([expect.stringContaining('still downloading')]);
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
