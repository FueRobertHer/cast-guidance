import { describe, expect, it } from 'vitest';
import type { PreparedCharacterImport } from '@/db/characterRepo';
import type { HomebrewFileRow } from '@/db/db';
import type { HomebrewFile } from '@/db/homebrewRepo';
import { newCharacterDoc } from '@/engine/types';
import type { OfficialIndex } from '@/features/homebrew/importPreview';
import { previewCharacterImport } from './importPreview';

function brew(id: string, sourceIds: string[]): HomebrewFileRow {
  return {
    id,
    fileName: `${id}.json`,
    json: { _meta: { sources: sourceIds.map((json) => ({ json })) } },
    enabled: true,
    editable: false,
    sourceIds,
    counts: { spell: 1 },
    addedAt: 1,
  };
}

function local(id: string, sourceIds: string[], enabled = true): HomebrewFile {
  const row = brew(id, sourceIds);
  return { ...row, json: row.json as Record<string, unknown>, enabled };
}

const officialPhb = (complete = true): OfficialIndex => ({
  uids: new Map(),
  clashKeys: new Map(),
  sources: new Set(['phb']),
  complete,
});

function prepared(homebrew: HomebrewFileRow[] = []): PreparedCharacterImport {
  const doc = newCharacterDoc('hero', 'Aria', 'tag');
  doc.classes = [
    { ref: { name: 'Mage', source: 'PHB' }, levels: 3, hp: [] },
    { ref: { name: 'Warrior', source: 'HB' }, levels: 1, hp: [] },
  ];
  return { doc, homebrew, bytes: 2048 };
}

describe('previewCharacterImport on shapes the importer accepts', () => {
  const base = { existing: [], official: officialPhb(), characterExists: false };
  const shaped = (edit: (doc: Record<string, unknown>) => void): PreparedCharacterImport => {
    const p = prepared();
    edit(p.doc as unknown as Record<string, unknown>);
    return p;
  };

  it('reads a character with no class list', () => {
    const p = previewCharacterImport({ ...base, prepared: shaped((d) => delete d.classes) });
    expect(p.classLabel).toBe('');
  });

  it('names a class entry with no reference as an unknown class', () => {
    const p = previewCharacterImport({
      ...base,
      prepared: shaped((d) => {
        d.classes = [{ levels: 2, hp: [] }];
      }),
    });
    expect(p.classLabel).toBe('Unknown class 2');
  });

  it('ignores a stray value among the homebrew dependencies', () => {
    const p = previewCharacterImport({
      ...base,
      prepared: shaped((d) => {
        d.homebrewDeps = [5, 'Gone'];
      }),
    });
    expect(p.missingSources.sort()).toEqual(['gone', 'hb']);
  });
});

describe('previewCharacterImport', () => {
  it('says when a file already here is turned off', () => {
    const p = previewCharacterImport({
      prepared: prepared([brew('same', ['SAME']), brew('on', ['ON'])]),
      characterExists: false,
      existing: [local('same', ['SAME'], false), local('on', ['ON'])],
      official: officialPhb(),
    });
    expect(p.files.map((f) => [f.status, f.existingEnabled])).toEqual([
      ['already-here', false],
      ['already-here', true],
    ]);
  });

  it('names the character and says when it imports as a copy', () => {
    const base = { prepared: prepared(), existing: [], official: officialPhb() };
    const fresh = previewCharacterImport({ ...base, characterExists: false });
    expect(fresh).toMatchObject({
      name: 'Aria',
      classLabel: 'Mage 3 / Warrior 1',
      importsAsCopy: false,
      bytes: 2048,
    });
    expect(previewCharacterImport({ ...base, characterExists: true }).importsAsCopy).toBe(true);
  });

  it('gives each embedded file one of three statuses', () => {
    const p = previewCharacterImport({
      prepared: prepared([
        brew('same-content', ['SAME']),
        brew('fresh', ['NEW']),
        brew('their-version', ['hb']),
        // Repeated inside the export: the commit skips it, so it is listed once.
        brew('fresh', ['NEW']),
      ]),
      characterExists: false,
      existing: [local('same-content', ['SAME']), local('my-version', ['HB'])],
      official: officialPhb(),
    });
    expect(p.files.map((f) => [f.fileName, f.status])).toEqual([
      ['same-content.json', 'already-here'],
      ['fresh.json', 'new'],
      ['their-version.json', 'other-version'],
    ]);
    expect(p.files[2]?.localFiles).toEqual([
      { id: 'my-version', fileName: 'my-version.json', enabled: true },
    ]);
    expect(p.files[0]?.localFiles).toEqual([]);
    expect(p.files[1]?.counts).toEqual({ spell: 1 });
  });

  it('does not call a file another version when the only local one is turned off', () => {
    const p = previewCharacterImport({
      prepared: prepared([brew('their-version', ['HB'])]),
      characterExists: false,
      existing: [local('my-version', ['HB'], false)],
      official: officialPhb(),
    });
    expect(p.files[0]?.status).toBe('new');
    // Still listed, so the preview can say it wins again if turned back on.
    expect(p.files[0]?.localFiles).toEqual([
      { id: 'my-version', fileName: 'my-version.json', enabled: false },
    ]);
  });

  it('sorts the sources nothing provides by why', () => {
    const doc = prepared([brew('emb', ['EMB'])]);
    doc.doc.race = { name: 'Elf', source: 'EMB' };
    doc.doc.background = { name: 'Sage', source: 'LOC' };
    doc.doc.feats = [{ ref: { name: 'Lucky', source: 'OFF' }, instanceId: 'f1' }];
    doc.doc.homebrewDeps = ['GONE'];
    const existing = [local('loc', ['LOC']), local('off', ['OFF'], false)];

    const done = previewCharacterImport({
      prepared: doc,
      characterExists: false,
      existing,
      official: officialPhb(),
    });
    // PHB is official, EMB is in the file, LOC is a local file.
    expect(done.missingSources.sort()).toEqual(['gone', 'hb']);
    expect(done.disabledSources).toEqual(['off']);
    expect(done.notDownloadedSources).toEqual([]);
    expect(done.notes).toEqual([]);

    const downloading = previewCharacterImport({
      prepared: doc,
      characterExists: false,
      existing,
      official: officialPhb(false),
    });
    expect(downloading.missingSources).toEqual([]);
    expect(downloading.notDownloadedSources.sort()).toEqual(['gone', 'hb']);
    expect(downloading.notes).toEqual([
      expect.stringContaining('Not all game data is on this device yet'),
    ]);

    const none = previewCharacterImport({
      prepared: doc,
      characterExists: false,
      existing,
      official: null,
    });
    expect(none.notDownloadedSources.sort()).toEqual(['gone', 'hb', 'phb']);
    expect(none.notes).toEqual([expect.stringContaining('not checked')]);
  });
});
