// Real IndexedDB-backed coverage (TEST-002) for the transactional repo paths
// that were previously only verifiable in the browser. `fake-indexeddb/auto`
// installs an in-memory IndexedDB before Dexie is imported.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import { CHARACTER_EXPORT_FORMAT } from '@/lib/guards';
import { isQuotaError } from '@/lib/storageErrors';
import { injectIdbFault, removeIdbFaults } from '../../tests-fixtures/idbFaults';
import { characterRepo, partitionCharacterRows } from './characterRepo';
import { db, type HomebrewFileRow } from './db';
import { historyRepo } from './historyRepo';
import { homebrewRepo } from './homebrewRepo';

function brewFile(sourceId: string, spellName: string) {
  return {
    _meta: { sources: [{ json: sourceId, abbreviation: sourceId, full: sourceId }] },
    spell: [{ name: spellName, source: sourceId, level: 1 }],
  };
}

function exportText(character: unknown, homebrew: unknown[] = []): string {
  return JSON.stringify({ $format: CHARACTER_EXPORT_FORMAT, character, homebrew });
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

afterEach(async () => {
  await removeIdbFaults();
  vi.restoreAllMocks();
});

describe('characterRepo.importExport (IndexedDB-backed)', () => {
  it('commits the character and embedded homebrew, content-hashing identity', async () => {
    const doc = newCharacterDoc('hero-1', 'Imported', 'tag');
    const summary = await characterRepo.importFromText(
      exportText(doc, [{ fileName: 'b.json', json: brewFile('BREW', 'Zap') }]),
    );

    expect(summary).toMatchObject({ homebrewAdded: 1, homebrewSkipped: 0, renamed: false });
    expect(await db.characters.count()).toBe(1);
    const brews = await db.homebrewFiles.toArray();
    expect(brews).toHaveLength(1);
    expect(brews[0]?.id).toMatch(/^[0-9a-f]{64}$/); // content hash, not caller-supplied
    expect(brews[0]?.editable).toBe(false);
    expect(brews[0]?.sourceIds).toEqual(['BREW']);
  });

  it('recomputes homebrew id so a forged id cannot overwrite a local file', async () => {
    const victim: HomebrewFileRow = {
      id: 'LOCAL-VICTIM',
      fileName: 'victim.json',
      json: brewFile('VICTIM', 'Real Spell'),
      enabled: true,
      editable: true,
      sourceIds: ['VICTIM'],
      counts: { spell: 1 },
      addedAt: 1,
    };
    await db.homebrewFiles.put(victim);

    await characterRepo.importFromText(
      exportText(newCharacterDoc('h', 'H', 'tag'), [
        // Forges the victim's id, claims editable, with different content.
        {
          id: 'LOCAL-VICTIM',
          editable: true,
          fileName: 'evil.json',
          json: brewFile('ATTACKER', 'Evil'),
        },
      ]),
    );

    const stillVictim = await db.homebrewFiles.get('LOCAL-VICTIM');
    expect(stillVictim?.editable).toBe(true);
    expect(JSON.stringify(stillVictim?.json)).toContain('Real Spell');
    // The imported file landed under its own content hash, editable forced off.
    const imported = (await db.homebrewFiles.toArray()).find((r) => r.id !== 'LOCAL-VICTIM');
    expect(imported?.editable).toBe(false);
    expect(imported?.sourceIds).toEqual(['ATTACKER']);
  });

  it('renames on id collision and skips duplicate homebrew on re-import', async () => {
    const text = exportText(newCharacterDoc('dup-id', 'Dup', 'tag'), [
      { fileName: 'b.json', json: brewFile('BREW', 'Zap') },
    ]);
    const first = await characterRepo.importFromText(text);
    const second = await characterRepo.importFromText(text);

    expect(first.renamed).toBe(false);
    expect(second.renamed).toBe(true);
    expect(second.id).not.toBe('dup-id');
    expect(second.homebrewAdded).toBe(0);
    expect(second.homebrewSkipped).toBe(1);
    expect(await db.characters.count()).toBe(2);
    expect(await db.homebrewFiles.count()).toBe(1); // no duplicate homebrew
  });

  it('rolls the whole import back when the character write fails', async () => {
    const putSpy = vi
      .spyOn(db.characters, 'put')
      .mockRejectedValueOnce(new Error('simulated write failure'));

    await expect(
      characterRepo.importFromText(
        exportText(newCharacterDoc('h', 'H', 'tag'), [
          { fileName: 'b.json', json: brewFile('BREW', 'Zap') },
        ]),
      ),
    ).rejects.toThrow('simulated write failure');

    // The embedded homebrew add in the same transaction must not persist.
    expect(await db.homebrewFiles.count()).toBe(0);
    expect(await db.characters.count()).toBe(0);
    putSpy.mockRestore();
  });

  it('rolls back the files already added when a later homebrew add runs out of space', async () => {
    // The first embedded file goes in, the second is refused by the database
    // itself (not a mocked Table method), before the character is written.
    const fault = await injectIdbFault(db, { tables: ['homebrewFiles'], ops: ['add'], skip: 1 });

    const err = await characterRepo
      .importFromText(
        exportText(newCharacterDoc('h', 'H', 'tag'), [
          { fileName: 'a.json', json: brewFile('ALPHA', 'Zap') },
          { fileName: 'b.json', json: brewFile('BETA', 'Zip') },
        ]),
      )
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    // The first add went through and the second was the one refused.
    expect(fault.attempts).toBe(2);
    expect(fault.hits).toBe(1);
    expect(isQuotaError(err)).toBe(true);
    expect(await db.homebrewFiles.count()).toBe(0);
    expect(await db.characters.count()).toBe(0);
  });

  it('rolls back the embedded homebrew when the database refuses the character', async () => {
    const fault = await injectIdbFault(db, { tables: ['characters'] });

    const err = await characterRepo
      .importFromText(
        exportText(newCharacterDoc('h', 'H', 'tag'), [
          { fileName: 'b.json', json: brewFile('BREW', 'Zap') },
        ]),
      )
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(fault.hits).toBe(1);
    expect(isQuotaError(err)).toBe(true);
    expect(await db.homebrewFiles.count()).toBe(0);
    expect(await db.characters.count()).toBe(0);
  });

  it('leaves the database untouched on malformed / future-version imports', async () => {
    await db.characters.put(newCharacterDoc('existing', 'Keep', 'tag'));

    await expect(characterRepo.importFromText('{ not json')).rejects.toThrow();
    await expect(
      characterRepo.importFromText(exportText({ id: 'x', schemaVersion: 9999, name: 'Future' })),
    ).rejects.toThrow();

    expect(await db.characters.count()).toBe(1); // only the pre-existing one
    expect((await db.characters.toArray())[0]?.id).toBe('existing');
  });
});

describe('characterRepo.prepareImport and commitImport (IndexedDB-backed)', () => {
  const text = () =>
    exportText(newCharacterDoc('hero-1', 'Imported', 'tag'), [
      { fileName: 'b.json', json: brewFile('BREW', 'Zap') },
    ]);

  it('prepares without writing to any table', async () => {
    const prepared = await characterRepo.prepareImport(text());
    expect(prepared.doc.id).toBe('hero-1');
    expect(prepared.homebrew.map((r) => r.sourceIds)).toEqual([['BREW']]);
    expect(prepared.bytes).toBe(new TextEncoder().encode(text()).byteLength);
    for (const table of db.tables) expect(await table.count()).toBe(0);
  });

  it('decides again at commit, so a file another tab added meanwhile is skipped', async () => {
    const prepared = await characterRepo.prepareImport(text());
    // Another tab imports the same homebrew and a character with the same id.
    await homebrewRepo.importJson(brewFile('BREW', 'Zap'), 'mine.json');
    await db.characters.put(newCharacterDoc('hero-1', 'Theirs', 'tag'));

    const summary = await characterRepo.commitImport(prepared);
    expect(summary).toMatchObject({ homebrewAdded: 0, homebrewSkipped: 1, renamed: true });
    expect(await db.homebrewFiles.count()).toBe(1);
    expect((await db.homebrewFiles.toArray())[0]?.fileName).toBe('mine.json');
    expect(await db.characters.count()).toBe(2);
  });

  it('stamps embedded homebrew with the time of the commit', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const prepared = await characterRepo.prepareImport(text());
    now.mockReturnValue(5_000);
    await characterRepo.commitImport(prepared);
    expect((await db.homebrewFiles.toArray()).map((r) => r.addedAt)).toEqual([5_000]);
  });
});

describe('characterRepo.delete (IndexedDB-backed)', () => {
  it('removes the character and its history together', async () => {
    await characterRepo.put(newCharacterDoc('c1', 'A', 'tag'));
    await db.characterHistory.add({
      id: 'h1',
      charId: 'c1',
      at: 1,
      label: 'snapshot',
      doc: newCharacterDoc('c1', 'A', 'tag'),
    });

    await characterRepo.delete('c1');

    expect(await db.characters.count()).toBe(0);
    expect(await db.characterHistory.count()).toBe(0);
  });
});

// REL-007 (#98): every write stamps an opaque revision, and the session's save
// is checked against the one it last read. The revision never leaves the repo.
describe('characterRepo revisions (IndexedDB-backed)', () => {
  const stored = () => db.characters.get('c1');

  it('stamps a fresh revision on every write, and never hands it out', async () => {
    const doc = newCharacterDoc('c1', 'Wren', 'tag');
    await characterRepo.put(doc);
    const first = (await stored())?.revision;
    expect(first).toEqual(expect.any(String));

    const result = await characterRepo.save(
      { ...doc, notes: 'x' },
      {
        kind: 'revision',
        revision: first,
        content: doc,
      },
    );
    const second = (await stored())?.revision;
    expect(result).toEqual({ status: 'saved', revision: second });
    expect(second).not.toBe(first);

    // Every read strips it, so no export, preview or snapshot carries it.
    expect(await characterRepo.get('c1')).not.toHaveProperty('revision');
    expect((await characterRepo.list())[0]).not.toHaveProperty('revision');
    expect((await characterRepo.listSafe()).characters[0]).not.toHaveProperty('revision');
    const read = await characterRepo.getWithRevision('c1');
    expect(read?.doc).not.toHaveProperty('revision');
    expect(read?.revision).toBe(second);
    expect(partitionCharacterRows([{ ...doc, revision: 'r' }]).characters[0]).not.toHaveProperty(
      'revision',
    );
  });

  it('refuses a save on a stale revision and leaves the row exactly as it was', async () => {
    const doc = newCharacterDoc('c1', 'Wren', 'tag');
    await characterRepo.put(doc);
    const before = await stored();

    const result = await characterRepo.save(
      { ...doc, name: 'Stale' },
      {
        kind: 'revision',
        revision: 'an-older-one',
        content: doc,
      },
    );

    expect(result).toEqual({ status: 'conflict' });
    expect(await stored()).toEqual(before);
  });

  it('refuses a save when the content is not the copy expected, whatever the revision', async () => {
    const doc = newCharacterDoc('c1', 'Wren', 'tag');
    await characterRepo.put(doc);
    const revision = (await stored())?.revision;

    const result = await characterRepo.save(
      { ...doc, notes: 'mine' },
      {
        kind: 'revision',
        revision,
        content: { ...doc, name: 'What this tab thought was stored' },
      },
    );
    expect(result).toEqual({ status: 'conflict' });
  });

  it('saves over a row from before revisions, which has none', async () => {
    // Every existing character is such a row on the day this ships: treating
    // it as a conflict would refuse everyone's first save.
    const doc = newCharacterDoc('c1', 'Wren', 'tag');
    await db.characters.put(doc);

    const result = await characterRepo.save(
      { ...doc, name: 'Saved' },
      {
        kind: 'revision',
        revision: undefined,
        content: doc,
      },
    );
    expect(result.status).toBe('saved');
    expect((await stored())?.name).toBe('Saved');
  });

  it('writes nothing for a missing row, unless it is expected to be absent', async () => {
    const doc = newCharacterDoc('c1', 'Wren', 'tag');
    const expectAt = { kind: 'revision' as const, revision: 'r', content: doc };
    expect(await characterRepo.save(doc, expectAt)).toEqual({ status: 'missing' });
    expect(await stored()).toBeUndefined();

    expect((await characterRepo.save(doc, { kind: 'absent' })).status).toBe('saved');
    expect((await stored())?.name).toBe('Wren');
    // Present now, so a second create is refused.
    const again = await characterRepo.save({ ...doc, name: 'Again' }, { kind: 'absent' });
    expect(again).toEqual({ status: 'conflict' });
  });

  it('calls a refused save that would change nothing saved, without writing', async () => {
    const doc = newCharacterDoc('c1', 'Wren', 'tag');
    await characterRepo.put(doc);
    const before = await stored();

    const result = await characterRepo.save(doc, { kind: 'revision', revision: 'old' });
    expect(result).toEqual({ status: 'saved', revision: before?.revision });
    expect(await stored()).toEqual(before);
  });

  it('decides inside one transaction, so of two racing saves on one revision only one lands', async () => {
    const doc = newCharacterDoc('c1', 'Wren', 'tag');
    await characterRepo.put(doc);
    const revision = (await stored())?.revision;
    const expectAt = { kind: 'revision' as const, revision, content: doc };

    // The second save starts while the first has read the row and not yet
    // written, outside the first's transaction. Checked in a transaction of
    // its own, the read would race the write and both would pass.
    const get = db.characters.get.bind(db.characters);
    let second: Promise<unknown> | undefined;
    vi.spyOn(db.characters, 'get').mockImplementationOnce(((key: string) =>
      get(key).then((row) => {
        second = Dexie.ignoreTransaction(() =>
          characterRepo.save({ ...doc, name: 'Second' }, expectAt),
        );
        return row;
      })) as typeof db.characters.get);

    const first = await characterRepo.save({ ...doc, name: 'First' }, expectAt);
    expect(first.status).toBe('saved');
    expect(await second).toEqual({ status: 'conflict' });
    expect((await stored())?.name).toBe('First');
  });

  it('gives an import its own revision, whatever the file says', async () => {
    const doc = { ...newCharacterDoc('c1', 'Wren', 'tag'), revision: 'from-the-file' };
    const prepared = await characterRepo.prepareImport(exportText(doc));
    expect(prepared.doc).not.toHaveProperty('revision');
    await characterRepo.commitImport(prepared);
    const revision = (await stored())?.revision;
    expect(revision).toEqual(expect.any(String));
    expect(revision).not.toBe('from-the-file');
  });

  it('never repeats a revision when a deleted character is imported again under its id', async () => {
    // A counter would start over at the same value, and a tab still holding
    // that value from before the delete would save over the import.
    const text = exportText(newCharacterDoc('c1', 'Wren', 'tag'));
    await characterRepo.importFromText(text);
    const before = (await stored())?.revision;
    await characterRepo.delete('c1');
    await characterRepo.importFromText(text);
    expect((await stored())?.revision).not.toBe(before);
  });

  it('gives a duplicate a revision of its own', async () => {
    await characterRepo.put(newCharacterDoc('c1', 'Wren', 'tag'));
    const copy = await characterRepo.duplicate('c1');
    const copyRow = await db.characters.get(copy?.id ?? '');
    expect(copyRow?.revision).toEqual(expect.any(String));
    expect(copyRow?.revision).not.toBe((await stored())?.revision);
  });

  it('renames by patching the name alone, with a new revision', async () => {
    const doc = newCharacterDoc('c1', 'Wren', 'tag');
    await characterRepo.put(doc);
    // Another tab's HP save landed after the roster read its copy.
    const row = await stored();
    if (row === undefined) throw new Error('no row');
    await db.characters.put({ ...row, play: { ...row.play, currentHp: 3 } });

    expect(await characterRepo.rename('c1', 'Wren the Bold')).toBe(true);
    const after = await stored();
    expect([after?.name, after?.play.currentHp]).toEqual(['Wren the Bold', 3]);
    expect(after?.revision).not.toBe(row.revision);
    expect(await characterRepo.rename('gone', 'Nobody')).toBe(false);
    expect(await db.characters.get('gone')).toBeUndefined();
  });

  it('creates under a fresh id rather than over a character that has the id', async () => {
    const theirs = newCharacterDoc('c1', 'Theirs', 'tag');
    await characterRepo.put(theirs);

    const created = await characterRepo.create(newCharacterDoc('c1', 'Mine', 'tag'));
    expect(created.id).not.toBe('c1');
    expect((await stored())?.name).toBe('Theirs');
    expect((await db.characters.get(created.id))?.name).toBe('Mine');
    // A free id is kept.
    expect((await characterRepo.create(newCharacterDoc('c2', 'New', 'tag'))).id).toBe('c2');
  });

  it('reports each write to the characters table, and only those', async () => {
    const listener = vi.fn();
    const stop = characterRepo.onChange(listener);
    const doc = newCharacterDoc('c1', 'Wren', 'tag');
    await characterRepo.put(doc);
    await characterRepo.rename('c1', 'Wren the Bold');
    await homebrewRepo.importJson(brewFile('BREW', 'Zap'), 'b.json');
    // Its history is another table, whose name only starts the same.
    await historyRepo.record(doc, 'Snapshot');
    await characterRepo.delete('c1');
    stop();
    await characterRepo.put(doc);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('reports a page back from the back-forward cache, which may have missed writes', () => {
    // Dexie's own notice for that case names no table, only `all`.
    const listener = vi.fn();
    const stop = characterRepo.onChange(listener);
    Dexie.on.storagemutated.fire({ all: {} } as unknown as Parameters<
      typeof Dexie.on.storagemutated.fire
    >[0]);
    stop();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
