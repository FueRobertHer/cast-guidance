// IndexedDB-backed coverage for the homebrew repository (TEST-002 harness).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@/lib/guards';
import { isQuotaError } from '@/lib/storageErrors';
import { injectIdbFault, removeIdbFaults } from '../../tests-fixtures/idbFaults';
import { db } from './db';
import { buildHomebrewRow, homebrewRepo } from './homebrewRepo';

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
    expect(await db.homebrewFiles.get(first.id)).toEqual(first);
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
