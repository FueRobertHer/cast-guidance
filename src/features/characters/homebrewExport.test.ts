import { describe, expect, it } from 'vitest';
import type { HomebrewFileRow } from '@/db/db';
import { newCharacterDoc } from '@/engine/types';
import { collectCharacterSources, homebrewForExport } from './homebrewExport';

function brew(id: string, sourceIds: string[]): HomebrewFileRow {
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
