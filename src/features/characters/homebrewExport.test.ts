import { describe, expect, it } from 'vitest';
import type { HomebrewFile } from '@/db/homebrewRepo';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { collectCharacterRefs, collectCharacterSources, homebrewForExport } from './homebrewExport';

function brew(id: string, sourceIds: string[]): HomebrewFile {
  return {
    id,
    fileName: `${id}.json`,
    json: { _meta: { sources: sourceIds.map((s) => ({ json: s })) }, spell: [] },
    enabled: true,
    editable: true,
    sourceIds,
    counts: {},
    addedAt: 1,
    rev: 2,
  };
}

describe('collectCharacterSources', () => {
  it('gathers sources from every ref location', () => {
    const doc = newCharacterDoc('c', 'Hero', 'tag');
    doc.race = { name: 'Brewfolk', source: 'MyBrew' };
    doc.classes = [
      {
        ref: { name: 'Wizard', source: 'PHB' },
        subclass: { name: 'Brew School', source: 'MyBrew2' },
        levels: 3,
        hp: [],
      },
    ];
    doc.feats = [{ ref: { name: 'Brew Feat', source: 'FeatBrew' }, instanceId: 'i1' }];
    doc.spellcasting = {
      wizard: { known: [{ name: 'Brew Bolt', source: 'SpellBrew' }], prepared: [] },
    };
    const sources = collectCharacterSources(doc);
    expect(sources).toEqual(new Set(['mybrew', 'phb', 'mybrew2', 'featbrew', 'spellbrew']));
  });

  it('reads a malformed document without throwing', () => {
    // Shapes the importer and the roster accept: lists missing, an entry with
    // no reference, a spellcasting block with no lists, stray values.
    const doc = {
      ...newCharacterDoc('c', 'Hero', 'tag'),
      classes: undefined,
      feats: [null, { ref: 7 }],
      equipment: 'not a list',
      spellcasting: { wizard: {}, cleric: { known: [{ name: 'Bless', source: 'PHB' }, 3] } },
      homebrewDeps: [5, 'MyBrew', ''],
    } as unknown as CharacterDoc;
    expect(collectCharacterSources(doc)).toEqual(new Set(['phb', 'mybrew']));
  });
});

describe('homebrewForExport', () => {
  const doc = (() => {
    const d = newCharacterDoc('c', 'Hero', 'tag');
    d.race = { name: 'Brewfolk', source: 'MyBrew' };
    return d;
  })();

  it('includes only homebrew the character depends on', () => {
    const enabled = [brew('a', ['MyBrew']), brew('b', ['UnrelatedBrew'])];
    const out = homebrewForExport(doc, enabled);
    expect(out).toHaveLength(1);
    expect(
      (out[0]?.json as { _meta: { sources: Array<{ json: string }> } })._meta.sources[0]?.json,
    ).toBe('MyBrew');
  });

  it('matches source ids case-insensitively', () => {
    expect(homebrewForExport(doc, [brew('a', ['mybrew'])])).toHaveLength(1);
  });

  it('emits a minimal DTO with no local-only fields', () => {
    const out = homebrewForExport(doc, [brew('a', ['MyBrew'])]);
    expect(Object.keys(out[0] ?? {}).sort()).toEqual(['fileName', 'json']);
    expect(out[0]).not.toHaveProperty('enabled');
    expect(out[0]).not.toHaveProperty('editable');
    expect(out[0]).not.toHaveProperty('rev');
    expect(out[0]).not.toHaveProperty('addedAt');
  });

  it('ships nothing when the character uses no homebrew', () => {
    const plain = newCharacterDoc('c2', 'Plain', 'tag');
    expect(homebrewForExport(plain, [brew('a', ['MyBrew'])])).toEqual([]);
  });
});

describe('homebrewForExport of a book', () => {
  /** One book of a converted compendium, as it is stored. */
  function book(json: Record<string, unknown>): HomebrewFile {
    return { ...brew('book', ['FCEmber']), fileName: 'all.xml', book: 'Ember Codex', json };
  }
  const META = {
    sources: [{ json: 'FCEmber', full: 'Ember Codex' }],
    convertedFrom: { format: 'fc5-compendium', fileName: 'all.xml' },
  };
  const JSON_ = {
    _meta: META,
    spell: [
      { name: 'Ember Lance', source: 'FCEmber' },
      { name: 'Ember Ward', source: 'FCEmber' },
    ],
    optionalfeature: [
      { name: 'Ember Style', source: 'FCEmber' },
      { name: 'Ash Style', source: 'FCEmber' },
    ],
  };

  it('carries the part the character uses, its choices included, marked as a part', () => {
    const d = newCharacterDoc('c', 'Hero', 'tag');
    d.spellcasting = {
      wizard: { known: [{ name: 'Ember Lance', source: 'FCEmber' }], prepared: [] },
    };
    d.choices = { 'class:fighter|phb:style': ['ember style|fcember'], 'skill:pick': 'Arcana' };
    const [out] = homebrewForExport(d, [book(JSON_)]);
    expect(out).toEqual({
      fileName: 'all.xml',
      json: {
        _meta: { ...META, convertedFrom: { ...META.convertedFrom, subset: true } },
        spell: [JSON_.spell[0]],
        optionalfeature: [JSON_.optionalfeature[0]],
      },
    });
  });

  it('carries the whole book when the character names only its source', () => {
    const d = newCharacterDoc('c', 'Hero', 'tag');
    d.homebrewDeps = ['FCEmber'];
    expect(homebrewForExport(d, [book(JSON_)])).toEqual([{ fileName: 'all.xml', json: JSON_ }]);
  });

  it('counts a choice that names an entry toward the sources it uses', () => {
    const d = newCharacterDoc('c', 'Hero', 'tag');
    d.choices = { 'class:fighter|phb:style': ['Ember Style|FCEmber'], other: 3 };
    expect(collectCharacterSources(d)).toEqual(new Set(['fcember']));
  });

  it('carries what a part needs from another book, though the character never names it', () => {
    const ash: HomebrewFile = {
      ...brew('ash', ['FCAsh']),
      fileName: 'all.xml',
      book: 'Ashen Tome',
      json: {
        _meta: { ...META, sources: [{ json: 'FCAsh', full: 'Ashen Tome' }] },
        background: [
          { name: 'Ash Walker', source: 'FCAsh', feats: [{ 'ember feat|fcember': true }] },
        ],
      },
    };
    const ember = book({ ...JSON_, feat: [{ name: 'Ember Feat', source: 'FCEmber' }] });
    const d = newCharacterDoc('c', 'Hero', 'tag');
    d.background = { name: 'Ash Walker', source: 'FCAsh' };
    const out = homebrewForExport(d, [ember, ash]);
    expect(out.map((o) => Object.keys(o.json as object).filter((k) => k !== '_meta'))).toEqual([
      ['feat'],
      ['background'],
    ]);
  });

  it('reads a spell list too long to spread into a call', () => {
    const d = newCharacterDoc('c', 'Hero', 'tag');
    d.spellcasting = {
      wizard: { known: Array.from({ length: 200_000 }, () => 0) as never, prepared: [] },
    };
    expect(collectCharacterRefs(d)).toEqual([]);
  });
});
