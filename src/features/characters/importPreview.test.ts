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

describe('previewCharacterImport of part of a book', () => {
  const lance = { name: 'Ember Lance', source: 'FCEmber' };
  const withSpells = <T extends { json: unknown }>(f: T, spell: unknown[]): T => ({
    ...f,
    json: { ...(f.json as object), spell },
  });
  const part = withSpells(
    { ...brew('part', ['FCEmber']), book: 'Ember Codex', subset: true as const },
    [lance],
  );
  const preview = (existing: HomebrewFile[]) =>
    previewCharacterImport({
      prepared: prepared([part]),
      existing,
      official: officialPhb(),
      characterExists: false,
    }).files[0];
  const p = (existing: HomebrewFile[]) => preview(existing)?.status;

  it('says the book is here when what is here holds every entry of it', () => {
    expect(p([withSpells(local('whole', ['FCEmber']), [lance])])).toBe('book-here');
    // Another part of the book with the same entries holds it too.
    expect(p([withSpells({ ...local('other-part', ['FCEmber']), subset: true }, [lance])])).toBe(
      'book-here',
    );
    expect(p([])).toBe('new');
  });

  it('adds what the copy here from the same file lacks, and says how much', () => {
    const ward = { name: 'Ember Ward', source: 'FCEmber' };
    const here = (enabled: boolean, fileName = 'part.json') =>
      withSpells(
        {
          ...local('here', ['FCEmber'], enabled),
          fileName,
          book: 'Ember Codex',
          subset: true as const,
        },
        [ward],
      );
    expect(preview([here(true)])).toMatchObject({
      status: 'adds-to-book',
      adds: 1,
      existingEnabled: true,
    });
    expect(preview([here(false)])).toMatchObject({
      status: 'adds-to-book',
      existingEnabled: false,
    });
    // A copy another file brought is that file's: this one comes in beside it.
    expect(preview([here(true, 'other.xml')])?.status).toBe('other-version');
  });

  it('says the book is here when it lacks only another book`s entry', () => {
    const zap = { name: 'Zap', source: 'OTHER' };
    const stray = withSpells(
      { ...brew('part', ['FCEmber']), book: 'Ember Codex', subset: true as const },
      [lance, zap],
    );
    const here = withSpells(
      { ...local('here', ['FCEmber']), fileName: 'part.json', book: 'Ember Codex' },
      [lance],
    );
    const [file] = previewCharacterImport({
      prepared: prepared([stray]),
      existing: [here],
      official: officialPhb(),
      characterExists: false,
    }).files;
    expect(file).toMatchObject({ status: 'book-here', existingEnabled: true, localFiles: [] });
  });

  it('names the turned-off copies that would win over what it stores, and only those', () => {
    const ward = { name: 'Ember Ward', source: 'FCEmber' };
    const copy = (id: string, fileName: string, addedAt: number, enabled = false) =>
      withSpells({ ...local(id, ['FCEmber'], enabled), fileName, book: 'Ember Codex', addedAt }, [
        ward,
      ]);
    const names = (existing: HomebrewFile[]) => preview(existing)?.localFiles.map((f) => f.id);
    // Entries added to the copy here keep its place: an older copy wins, a newer one does not.
    const here = copy('here', 'part.json', 5, true);
    expect(names([here, copy('older', 'a.xml', 4), copy('newer', 'b.xml', 6)])).toEqual(['older']);
    // A file that comes in on its own is the newest: every copy here wins over it.
    expect(names([copy('older', 'a.xml', 4), copy('newer', 'b.xml', 6)])).toEqual([
      'older',
      'newer',
    ]);
    // Nothing is stored for a book here, so nothing is named.
    const whole = withSpells(local('whole', ['FCEmber']), [lance]);
    expect(names([whole, copy('older', 'a.xml', 0)])).toEqual([]);
  });

  it('says so when the book here is turned off', () => {
    const off = preview([withSpells(local('whole', ['FCEmber'], false), [lance])]);
    expect(off).toMatchObject({ status: 'book-here', existingEnabled: false });
    const on = preview([withSpells(local('whole', ['FCEmber']), [lance])]);
    expect(on).toMatchObject({ status: 'book-here', existingEnabled: true });
    // The entry is only in the file that is off: what is on does not hold it.
    const split = preview([
      withSpells(local('on', ['FCEmber']), [{ name: 'Ember Ward', source: 'FCEmber' }]),
      withSpells(local('off', ['FCEmber'], false), [lance]),
    ]);
    expect(split).toMatchObject({ status: 'book-here', existingEnabled: false });
  });

  it('brings the part in when the book here lacks one of its entries', () => {
    const older = withSpells(local('whole', ['FCEmber']), [
      { name: 'Ember Ward', source: 'FCEmber' },
    ]);
    expect(p([older])).toBe('other-version');
  });

  it('names a book, here and in the file, by the book rather than the file it came from', () => {
    const part = withSpells(
      { ...brew('part', ['FCEmber']), book: 'Ember Codex', subset: true as const },
      [lance],
    );
    const here = { ...local('here', ['FCEmber']), book: 'Ember Codex', subset: true as const };
    const [file] = previewCharacterImport({
      prepared: prepared([part]),
      existing: [here],
      official: officialPhb(),
      characterExists: false,
    }).files;
    expect(file?.fileName).toBe('Ember Codex');
    expect(file?.localFiles.map((f) => f.fileName)).toEqual(['Ember Codex']);
  });
});
