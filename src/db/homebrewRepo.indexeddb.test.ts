// IndexedDB-backed coverage for the homebrew repository (TEST-002 harness).
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertJsonWithinLimits, IMPORT_LIMITS, ValidationError } from '@/lib/guards';
import { isQuotaError } from '@/lib/storageErrors';
import { injectIdbFault, removeIdbFaults } from '../../tests-fixtures/idbFaults';
import { db } from './db';
import { buildHomebrewRow, homebrewRepo, putHomebrewRow } from './homebrewRepo';

function file(sourceId: string, spells: string[] = []) {
  return {
    _meta: { sources: [{ json: sourceId, abbreviation: sourceId, full: sourceId }] },
    spell: spells.map((name) => ({ name, source: sourceId, level: 1 })),
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await removeIdbFaults();
});

describe('homebrewRepo.importJson (IndexedDB-backed)', () => {
  it('stores a file under a content-hash id with recomputed metadata', async () => {
    const row = await homebrewRepo.importJson(file('BREW', ['Zap']), 'brew.json');
    expect(row.id).toMatch(/^[0-9a-f]{64}$/);
    expect(row.editable).toBe(false);
    expect(row.sourceIds).toEqual(['BREW']);
    expect(row.counts).toEqual({ spell: 1 });
    expect(await db.homebrewFiles.count()).toBe(1);
  });

  it('is idempotent — re-importing identical content returns the existing row', async () => {
    const a = await homebrewRepo.importJson(file('BREW', ['Zap']), 'brew.json');
    const b = await homebrewRepo.importJson(file('BREW', ['Zap']), 'renamed.json');
    expect(b.id).toBe(a.id);
    expect(await db.homebrewFiles.count()).toBe(1); // no duplicate
  });

  it('rejects an adversarially deep payload before storing', async () => {
    let deep: unknown = 0;
    for (let i = 0; i < 80; i++) deep = [deep];
    const payload = { ...file('BREW'), nested: deep };
    await expect(homebrewRepo.importJson(payload, 'evil.json')).rejects.toThrow(ValidationError);
    expect(await db.homebrewFiles.count()).toBe(0);
  });

  it('rejects with a quota error and stores nothing when the device is full', async () => {
    const fault = await injectIdbFault(db, { tables: ['homebrewFiles'] });

    const err = await homebrewRepo.importJson(file('BREW', ['Zap']), 'brew.json').then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(fault.hits).toBe(1);
    expect(isQuotaError(err)).toBe(true);
    expect(await db.homebrewFiles.count()).toBe(0);
    // Nothing half-written blocks the same file once there is room again.
    await fault();
    await homebrewRepo.importJson(file('BREW', ['Zap']), 'brew.json');
    expect(await db.homebrewFiles.count()).toBe(1);
  });
});

describe('homebrewRepo.prepare and commit (IndexedDB-backed)', () => {
  it('prepares a row without writing anything', async () => {
    const row = await homebrewRepo.prepare(file('BREW', ['Zap']), 'brew.json', 'https://x/y');
    expect(row).toMatchObject({ fileName: 'brew.json', url: 'https://x/y', sourceIds: ['BREW'] });
    expect(await db.homebrewFiles.count()).toBe(0);
  });

  it('commits a new row, stamped with the time it lands', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const prepared = await homebrewRepo.prepare(file('BREW', ['Zap']), 'brew.json');
    now.mockReturnValue(5_000);
    const { row, duplicate } = await homebrewRepo.commit(prepared);
    expect(duplicate).toBe(false);
    expect(row.addedAt).toBe(5_000);
    expect((await db.homebrewFiles.get(prepared.id))?.addedAt).toBe(5_000);
  });

  it('reports a duplicate and writes nothing', async () => {
    const first = await homebrewRepo.importJson(file('BREW', ['Zap']), 'brew.json');
    const again = await homebrewRepo.prepare(file('BREW', ['Zap']), 'renamed.json');
    const result = await homebrewRepo.commit({ ...again, addedAt: first.addedAt + 10 });
    expect(result.duplicate).toBe(true);
    expect(result.row.fileName).toBe('brew.json');
    expect(await db.homebrewFiles.count()).toBe(1);
    expect((await homebrewRepo.getSafe(first.id)).file).toEqual(first);
  });
});

describe('homebrewRepo editable files (IndexedDB-backed)', () => {
  it('bumps rev on each save so the registry/search signature changes', async () => {
    const created = await homebrewRepo.createEditable('My Brew', 'MB');
    expect(created.editable).toBe(true);

    await homebrewRepo.saveEditable(created.id, file('MB', ['One']));
    await homebrewRepo.saveEditable(created.id, file('MB', ['Two', 'Three']));

    const { file: saved } = await homebrewRepo.getSafe(created.id);
    expect(saved?.rev).toBe(2);
    expect(saved?.counts).toEqual({ spell: 2 });
    expect(saved?.id).toBe(created.id); // identity stable across edits
  });

  it('refuses to report a write against a file that is gone as a save', async () => {
    // Dexie's `modify`/`update` resolve with 0 rows matched rather than
    // throwing, so a builder save racing a delete in another tab used to
    // report success and write nothing at all.
    const created = await homebrewRepo.createEditable('My Brew', 'MB');
    await homebrewRepo.delete(created.id);

    await expect(homebrewRepo.saveEditable(created.id, file('MB', ['One']))).rejects.toThrow(
      'no longer exists',
    );
    await expect(homebrewRepo.setEnabled(created.id, false)).rejects.toThrow('no longer exists');
  });

  it('enabledSafe() returns only enabled files', async () => {
    const a = await homebrewRepo.importJson(file('A', ['x']), 'a.json');
    const b = await homebrewRepo.importJson(file('B', ['y']), 'b.json');
    await homebrewRepo.setEnabled(b.id, false);
    const enabled = await homebrewRepo.enabledSafe();
    expect(enabled.files.map((r) => r.id)).toEqual([a.id]);
    expect(enabled.errors).toEqual([]);
  });
});

describe('homebrewRepo.enabledSafe merge order', () => {
  // The registry merges homebrew in this order and keeps the first entity per
  // name|source, so this order is the precedence between homebrew files.
  it('returns the oldest import first, whatever the ids sort to', async () => {
    const put = (id: string, addedAt: number, enabled = true) =>
      db.homebrewFiles.put({
        id,
        fileName: `${id}.json`,
        json: {},
        enabled,
        editable: false,
        sourceIds: [],
        counts: {},
        addedAt,
      });
    await put('a', 9);
    await put('z', 1);
    await put('m', 5);
    await put('d', 5);
    await put('b', 2, false);

    const { files } = await homebrewRepo.enabledSafe();
    expect(files.map((f) => f.id)).toEqual(['z', 'd', 'm', 'a']);
  });
});

describe('the homebrew read boundary against the real database', () => {
  // importJson validates what it stores, but the row read back is whatever
  // IndexedDB holds. A direct write is the only way to reproduce that.
  it('reports an unreadable row and keeps serving the rest', async () => {
    const good = await homebrewRepo.importJson(file('A', ['x']), 'a.json');
    await db.homebrewFiles.put({ id: 'broken', fileName: 'broken.json', json: null } as never);

    const listed = await homebrewRepo.listSafe();
    expect(listed.files.map((r) => r.id)).toEqual([good.id]);
    expect(listed.errors).toEqual([
      { id: 'broken', fileName: 'broken.json', message: expect.stringContaining('not a JSON') },
    ]);

    // And the enabled read, which is the one the registry uses.
    const enabled = await homebrewRepo.enabledSafe();
    expect(enabled.files.map((r) => r.id)).toEqual([good.id]);
    expect(enabled.errors).toHaveLength(1);
  });

  it('lists newest first, including rows an ordered read would never see', async () => {
    // The order has to survive the read changing. Dexie's reversed traversal
    // broke ties on the primary key descending, and a same-millisecond import
    // is reachable: a character import writes several rows in a loop.
    const put = (id: string, addedAt: number | undefined) =>
      db.homebrewFiles.put({
        id,
        fileName: `${id}.json`,
        json: {},
        enabled: true,
        editable: false,
        sourceIds: [],
        counts: {},
        addedAt,
      } as never);
    await put('c', 5);
    await put('a', 5);
    await put('b', 9);
    await put('no-timestamp', undefined);

    const { files, errors } = await homebrewRepo.listSafe();
    expect(errors).toEqual([]);
    // b is newest; c and a tie and break on id descending; the row with no
    // timestamp is last rather than missing, which is the whole reason this
    // read no longer goes through the index.
    expect(files.map((f) => f.id)).toEqual(['b', 'c', 'a', 'no-timestamp']);
  });

  it('tells a file that cannot be read apart from one that is not there', async () => {
    await db.homebrewFiles.put({ id: 'broken', fileName: 'broken.json', json: 7 } as never);

    const broken = await homebrewRepo.getSafe('broken');
    expect(broken.file).toBeUndefined();
    expect(broken.error?.fileName).toBe('broken.json');

    const missing = await homebrewRepo.getSafe('never-existed');
    expect(missing.file).toBeUndefined();
    expect(missing.error).toBeUndefined();
  });
});

describe('buildHomebrewRow', () => {
  it('produces a stable content hash independent of the file name', async () => {
    const r1 = await buildHomebrewRow(file('BREW', ['Zap']), 'one.json');
    const r2 = await buildHomebrewRow(file('BREW', ['Zap']), 'two.json');
    expect(r1.id).toBe(r2.id);
  });
});

describe('homebrew content apart from its metadata', () => {
  it('lists metadata without reading any content', async () => {
    await homebrewRepo.importJson(file('BREW', ['Zap']), 'brew.json');
    const reads = vi.spyOn(db.homebrewJson, 'bulkGet');

    const { files } = await homebrewRepo.listMetaSafe();
    const enabled = await homebrewRepo.enabledMetaSafe();

    expect(files.map((f) => f.sourceIds)).toEqual([['BREW']]);
    expect(files[0]).not.toHaveProperty('json');
    expect(enabled.files.map((f) => f.fileName)).toEqual(['brew.json']);
    expect(reads).not.toHaveBeenCalled();
  });

  it('stores the content in its own table, and removes it with the file', async () => {
    const row = await homebrewRepo.importJson(file('BREW', ['Zap']), 'brew.json');
    expect(await db.homebrewFiles.get(row.id)).not.toHaveProperty('json');
    expect((await db.homebrewJson.get(row.id))?.json).toEqual(row.json);

    await homebrewRepo.delete(row.id);
    expect(await db.homebrewJson.count()).toBe(0);
  });

  it('saves an edit to the content table and bumps the revision', async () => {
    const brew = await homebrewRepo.createEditable('Brew', 'BREW');
    await homebrewRepo.saveEditable(brew.id, file('BREW', ['Zap']));

    expect((await db.homebrewFiles.get(brew.id))?.rev).toBe(1);
    expect((await homebrewRepo.getSafe(brew.id)).file?.json).toEqual(file('BREW', ['Zap']));
  });

  it('reads a row that still carries its content', async () => {
    await db.homebrewFiles.put({
      id: 'legacy',
      fileName: 'legacy.json',
      json: file('OLD', ['Zap']),
      enabled: true,
      editable: false,
      sourceIds: ['OLD'],
      counts: { spell: 1 },
      addedAt: 1,
    });

    const { files, errors } = await homebrewRepo.enabledSafe();
    expect(errors).toEqual([]);
    expect(files.map((f) => f.json)).toEqual([file('OLD', ['Zap'])]);
  });

  it('reports a disabled row it cannot read without reading content', async () => {
    await db.homebrewFiles.put({ id: '', fileName: 'nameless.json', enabled: false } as never);
    const { files, errors } = await homebrewRepo.enabledSafe();
    expect(files).toEqual([]);
    expect(errors.map((e) => e.fileName)).toEqual(['nameless.json']);
  });
});

describe('the version 5 upgrade', () => {
  it('moves each stored file`s content into the content table', async () => {
    db.close();
    await Dexie.delete('cast-guidance');
    const old = new Dexie('cast-guidance');
    old.version(4).stores({
      dataFiles: 'key, tag, pack, bytes',
      dataMeta: 'id',
      characters: 'id, name, updatedAt',
      homebrewFiles: 'id, enabled, addedAt',
      searchIndexes: 'key',
      settings: 'key',
      rollLog: 'id, at, charId',
      characterHistory: 'id, charId, at, [charId+at]',
    });
    const stored = await buildHomebrewRow(file('BREW', ['Zap']), 'brew.json');
    await old.table('homebrewFiles').put(stored);
    old.close();

    await db.open();

    const { json, ...meta } = stored;
    expect(await db.homebrewFiles.get(stored.id)).toEqual(meta);
    expect(await db.homebrewJson.get(stored.id)).toEqual({ id: stored.id, json });
    expect((await homebrewRepo.listSafe()).files).toEqual([{ ...stored, rev: undefined }]);
  });
});

describe('a file stored a book at a time', () => {
  /** A converted compendium: one source per book, each with its spells. */
  function compendium(books: Record<string, string[]>) {
    return {
      _meta: {
        sources: Object.keys(books).map((id) => ({ json: id, full: `${id} Book` })),
        convertedFrom: { format: 'fc5-compendium', fileName: 'all.xml' },
      },
      spell: Object.entries(books).flatMap(([id, names]) =>
        names.map((name) => ({ name, source: id, level: 1 })),
      ),
    };
  }

  it('prepares one row per book, each named and hashed on its own', async () => {
    const { whole, books } = await homebrewRepo.prepareBooks(
      compendium({ EMB: ['Ember Lance', 'Ember Ward'], ASH: ['Ash Bolt'] }),
      'all.xml',
    );
    expect(books.map((b) => [b.book, b.fileName, b.sourceIds, b.counts])).toEqual([
      ['EMB Book', 'all.xml', ['EMB'], { spell: 2 }],
      ['ASH Book', 'all.xml', ['ASH'], { spell: 1 }],
    ]);
    expect(books[0]?.id).toMatch(/^[0-9a-f]{64}$/);
    expect(books[0]?.id).not.toBe(books[1]?.id);
    expect(whole.sourceIds).toEqual(['EMB', 'ASH']);
    expect(whole.counts).toEqual({ spell: 3 });
    expect(await db.homebrewFiles.count()).toBe(0);
  });

  it('holds each book to the limits of one file, and not the whole', async () => {
    const per = Math.floor(IMPORT_LIMITS.maxNodes / 4 / 5);
    const names = (book: string) => Array.from({ length: per }, (_, i) => `${book} ${i}`);
    // Each book is about a quarter of the limit; the whole is past it.
    const raw = compendium({
      A: names('A'),
      B: names('B'),
      C: names('C'),
      D: names('D'),
      E: names('E'),
    });
    expect(() => assertJsonWithinLimits(raw)).toThrow(ValidationError);
    const { books } = await homebrewRepo.prepareBooks(raw, 'all.xml');
    expect(books).toHaveLength(5);
  });

  it('stores the books, leaves one already here alone, and replaces its own older copy', async () => {
    const first = await homebrewRepo.prepareBooks(
      compendium({ EMB: ['Ember Lance'], ASH: ['Ash Bolt'] }),
      'all.xml',
    );
    await homebrewRepo.commitBooks(first.books);
    const oldAsh = first.books[1] as (typeof first.books)[number];
    await homebrewRepo.setEnabled(oldAsh.id, false);
    const oldAddedAt = (await db.homebrewFiles.get(oldAsh.id))?.addedAt;
    // A file stored whole that declares a book's source is no book: it stays.
    const whole = await homebrewRepo.importJson(file('ASH', ['Ash Storm']), 'ash.json');

    // The same file again, as a browser names a second download of it.
    const second = await homebrewRepo.prepareBooks(
      compendium({ EMB: ['Ember Lance'], ASH: ['Ash Bolt', 'Ash Veil'], NEW: ['Zap'] }),
      'all (1).xml',
    );
    const committed = await homebrewRepo.commitBooks(second.books);
    expect(committed.added.map((r) => r.book)).toEqual(['ASH Book', 'NEW Book']);
    expect(committed.replaced).toBe(1);
    expect(committed.same).toBe(1);

    const stored = (await homebrewRepo.listMetaSafe()).files;
    const byBook = new Map(stored.map((r) => [r.book ?? r.fileName, r]));
    expect(stored).toHaveLength(4);
    // The same Ember Codex as before, untouched.
    expect(byBook.get('EMB Book')?.fileName).toBe('all.xml');
    // The new Ashen copy, turned off as the old one was, in its place in the merge order.
    expect(byBook.get('ASH Book')).toMatchObject({
      fileName: 'all (1).xml',
      enabled: false,
      counts: { spell: 2 },
      addedAt: oldAddedAt,
    });
    expect(byBook.get('NEW Book')?.enabled).toBe(true);
    expect(byBook.get('ash.json')?.id).toBe(whole.id);
    expect(await db.homebrewJson.get(oldAsh.id)).toBeUndefined();
  });

  it('keeps the copy of a book another file brought, and stores the new one beside it', async () => {
    const first = await homebrewRepo.prepareBooks(
      compendium({ ASH: ['Ash Bolt', 'Ash Veil'] }),
      'five.xml',
    );
    await homebrewRepo.commitBooks(first.books);
    const second = await homebrewRepo.prepareBooks(
      compendium({ ASH: ['Ash Bolt', 'Cinder Step'] }),
      'five-and-a-half.xml',
    );
    const committed = await homebrewRepo.commitBooks(second.books);
    expect(committed.replaced).toBe(0);
    const stored = (await homebrewRepo.listMetaSafe()).files;
    expect(stored.map((r) => [r.fileName, r.book]).sort()).toEqual([
      ['five-and-a-half.xml', 'ASH Book'],
      ['five.xml', 'ASH Book'],
    ]);
  });

  it('replaces the same file stored whole before it was stored a book at a time', async () => {
    // As an import stored a converted file before books: one source named after the file.
    const legacy = (fileName: string) =>
      buildHomebrewRow(
        {
          _meta: {
            sources: [{ json: 'FCAll', full: 'all (Fight Club 5e)' }],
            convertedFrom: { format: 'fc5-compendium', fileName },
          },
          spell: [{ name: 'Ash Bolt', source: 'FCAll', level: 1 }],
        },
        fileName,
      ).then(async ({ book: _, ...row }) => {
        await putHomebrewRow(row);
        return row;
      });
    const old = await legacy('all.xml');
    const other = await legacy('other.xml');

    const { books } = await homebrewRepo.prepareBooks(compendium({ ASH: ['Ash Bolt'] }), 'all.xml');
    const committed = await homebrewRepo.commitBooks(books);
    expect(committed.replaced).toBe(1);
    expect(await db.homebrewFiles.get(old.id)).toBeUndefined();
    expect(await db.homebrewJson.get(old.id)).toBeUndefined();
    // Another file stored whole is not this one: it stays.
    expect(await db.homebrewFiles.get(other.id)).toBeDefined();
  });

  it('replaces the same file stored whole with a source per book', async () => {
    // As an import stored a converted file before its books were rows of their own.
    const { book: _, ...whole } = await buildHomebrewRow(
      compendium({ EMB: ['Ember Lance'], ASH: ['Ash Bolt'] }),
      'all.xml',
    );
    expect(whole.sourceIds).toEqual(['EMB', 'ASH']);
    await putHomebrewRow(whole);

    const { books } = await homebrewRepo.prepareBooks(
      compendium({ EMB: ['Ember Lance'], ASH: ['Ash Bolt'] }),
      'all (1).xml',
    );
    expect((await homebrewRepo.commitBooks(books)).replaced).toBe(1);
    const stored = (await homebrewRepo.listMetaSafe()).files;
    expect(stored.map((f) => f.book).sort()).toEqual(['ASH Book', 'EMB Book']);
  });

  it('removes every book of a file at once', async () => {
    const { books } = await homebrewRepo.prepareBooks(
      compendium({ EMB: ['Ember Lance'], ASH: ['Ash Bolt'] }),
      'all.xml',
    );
    await homebrewRepo.commitBooks(books);
    await homebrewRepo.deleteMany(books.map((b) => b.id));
    expect(await db.homebrewFiles.count()).toBe(0);
    expect(await db.homebrewJson.count()).toBe(0);
  });

  it('reads a stored book back with its name', async () => {
    const { books } = await homebrewRepo.prepareBooks(
      compendium({ EMB: ['Ember Lance'] }),
      'all.xml',
    );
    await homebrewRepo.commitBooks(books);
    const [meta] = (await homebrewRepo.listMetaSafe()).files;
    expect(meta?.book).toBe('EMB Book');
    const { file: read } = await homebrewRepo.getSafe(books[0]?.id ?? '');
    expect(read?.book).toBe('EMB Book');
  });
});
