// A collection keeps its identity (ADR-002, D4): a file imported again with
// its key updates the collection it was, and a collection made in the app has
// a source of its own. Real repository over fake-indexeddb.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectIdbFault } from '../../tests-fixtures/idbFaults';
import { db, type HomebrewFileRow } from './db';
import { collectionIdOf, withCollectionId } from './homebrewOrder';
import { buildHomebrewRow, homebrewRepo, putHomebrewRow } from './homebrewRepo';

/** The schema as version 5 left it. */
const V5 = {
  dataFiles: 'key, tag, pack, bytes',
  dataMeta: 'id',
  characters: 'id, name, updatedAt',
  homebrewFiles: 'id, enabled, addedAt',
  homebrewJson: 'id',
  searchIndexes: 'key',
  settings: 'key',
  rollLog: 'id, at, charId',
  characterHistory: 'id, charId, at, [charId+at]',
};

function file(sourceId: string, spells: string[] = []) {
  return {
    _meta: { sources: [{ json: sourceId, abbreviation: sourceId, full: `${sourceId} Book` }] },
    spell: spells.map((name) => ({ name, source: sourceId, level: 1 })),
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('suspected bug 8: two collections made in the app with one short code', () => {
  it('gives each its own source, so their entries are never confused', async () => {
    const a = await homebrewRepo.createEditable('Ember Tome', 'HB');
    const b = await homebrewRepo.createEditable('Ash Tome', 'HB');
    expect(a.sourceIds).toEqual(['HB']);
    expect(b.sourceIds).toHaveLength(1);
    expect(b.sourceIds[0]?.toLowerCase()).not.toBe('hb');
    // The file declares the source its row says.
    const meta = (b.json as { _meta: { sources: Array<{ json: string }> } })._meta;
    expect(meta.sources.map((s) => s.json)).toEqual(b.sourceIds);
  });
});

describe('suspected bug 9: a changed file imported again', () => {
  it('updates the collection it was, not a second one beside it', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const first = await homebrewRepo.importJson(file('EMB', ['Ember Lance']), 'ember.json');
    await homebrewRepo.setEnabled(first.id, false);
    now.mockReturnValue(9_000);
    const changed = file('EMB', ['Ember Lance', 'Ember Ward']);
    await homebrewRepo.importJson(changed, 'ember.json');

    const { files } = await homebrewRepo.listSafe();
    expect(files).toHaveLength(1);
    expect(files[0]?.json).toEqual(changed);
    // Its switch and its place in the merge order stay.
    expect(files[0]?.enabled).toBe(false);
    expect(files[0]?.addedAt).toBe(1_000);
  });
});

describe('a collection’s key', () => {
  it('is its link, so a file from the same link updates it whatever it is called', async () => {
    const url = 'https://example.org/brew/ember.json';
    await homebrewRepo.importJson(file('EMB', ['Ember Lance']), 'ember.json', url);
    await homebrewRepo.importJson(file('EMB2', ['Ember Ward']), 'ember (1).json', url);
    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => [f.key, f.sourceIds])).toEqual([[`url:${url}`, ['EMB2']]]);
  });

  it('else its first source and file name: another of either is another collection', async () => {
    await homebrewRepo.importJson(file('EMB', ['Ember Lance']), 'ember.json');
    await homebrewRepo.importJson(file('ASH', ['Ash Bolt']), 'ember.json');
    await homebrewRepo.importJson(file('EMB', ['Ember Ward']), 'other.json');
    // A browser's second download of a file is the same file.
    await homebrewRepo.importJson(file('EMB', ['Ember Lance', 'Ember Ward']), 'ember (1).json');
    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => f.key).sort()).toEqual([
      'file:ash|ember',
      'file:emb|ember',
      'file:emb|other',
    ]);
  });

  it('never matches a file the player owns, so an import cannot write over theirs', async () => {
    await homebrewRepo.saveEntry('spell', { name: 'Ember Lance', source: 'MyHomebrew', level: 1 });
    const { files: before } = await homebrewRepo.ownedSafe();
    const theirs = before[0];
    if (theirs === undefined) throw new Error('no Workshop file');
    // Their own file, downloaded and imported again on this device.
    await homebrewRepo.importJson(
      { ...theirs.json, spell: [{ name: 'Other', source: 'MyHomebrew', level: 2 }] },
      theirs.fileName,
    );
    const { files } = await homebrewRepo.listSafe();
    expect(files).toHaveLength(2);
    expect((await homebrewRepo.getSafe(theirs.id)).file?.json).toEqual(theirs.json);
  });

  it('folds copies that landed beside each other before into one, in the first one’s place', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const a = await homebrewRepo.prepare(file('EMB', ['Ember Lance']), 'ember.json');
    const b = await homebrewRepo.prepare(file('EMB', ['Ember Ward']), 'ember.json');
    // As two imports before keys stored them: side by side, the later one on.
    await db.transaction('rw', db.homebrewFiles, db.homebrewJson, async () => {
      await putHomebrewRow({ ...a, enabled: false, addedAt: 1_000 });
      await putHomebrewRow({ ...b, addedAt: 2_000 });
    });
    now.mockReturnValue(9_000);
    const changed = file('EMB', ['Ember Lance', 'Ember Ward', 'Ember Wall']);
    const committed = await homebrewRepo.commit(await homebrewRepo.prepare(changed, 'ember.json'));
    expect(committed.replaced.map((r) => r.id)).toEqual([a.id, b.id]);
    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => [f.json, f.enabled, f.addedAt])).toEqual([[changed, true, 1_000]]);
  });

  it('keeps who a pack applies to and its order through an update, over what the new one brings', async () => {
    const pack = (rest: string) => ({
      _meta: {
        sources: [{ json: 'GT', full: 'Gritty Table' }],
        castGuidance: { v: 1, tableRules: { restLength: rest } },
      },
    });
    const first = await homebrewRepo.prepare(pack('gritty'), 'gritty.json');
    await homebrewRepo.commit({ ...first, pack: { appliesTo: { characters: ['hild'] } } });
    await homebrewRepo.setPackLocal(first.id, (now) => ({ ...now, order: 3 }));
    const next = await homebrewRepo.prepare(pack('heroic'), 'gritty.json');
    await homebrewRepo.commit({
      ...next,
      pack: { appliesTo: { characters: [], appDefault: true } },
    });
    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => [f.id, f.pack, f.json])).toEqual([
      [next.id, { appliesTo: { characters: ['hild'] }, order: 3 }, pack('heroic')],
    ]);
  });
});

describe('a collection made in the app', () => {
  it('never takes a source another file here declares, or the app keeps for its own', async () => {
    await homebrewRepo.importJson(file('EMB', ['Ember Lance']), 'ember.json');
    expect((await homebrewRepo.createEditable('Ember', 'emb')).sourceIds).toEqual(['emb2']);
    expect((await homebrewRepo.createEditable('Mine', 'MyHomebrew')).sourceIds).toEqual([
      'MyHomebrew2',
    ]);
    expect((await homebrewRepo.createEditable('Fresh', 'FR')).sourceIds).toEqual(['FR']);
  });
});

describe('the id a collection made in the app is stamped with', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const stampOf = async (id: string) => collectionIdOf((await homebrewRepo.getSafe(id)).file?.json);

  it('is given when it is made, one of its own, whichever way it is made', async () => {
    const made = await homebrewRepo.createEditable('Ember', 'EMB');
    const workshop = await homebrewRepo.saveEntry('spell', {
      name: 'Ember Lance',
      source: 'MyHomebrew',
    });
    const changes = await homebrewRepo.saveEntry(
      'spell',
      { name: 'Fireball', source: 'PHB', level: 3 },
      { role: 'changes' },
    );
    const ids = [made.id, workshop.fileId, changes.fileId];
    const stamps = await Promise.all(ids.map(stampOf));
    for (const s of stamps) expect(s).toMatch(UUID);
    expect(new Set(stamps).size).toBe(3);
    expect(collectionIdOf(made.json)).toBe(stamps[0]);
  });

  it('is given to a file made before stamps on its first save, and kept by every save after', async () => {
    // A file the player made before files were stamped.
    const old: HomebrewFileRow = {
      id: 'mine',
      fileName: 'Ember.json',
      json: file('EMB'),
      enabled: true,
      editable: true,
      sourceIds: ['EMB'],
      counts: {},
      addedAt: 1,
    };
    await db.transaction('rw', db.homebrewFiles, db.homebrewJson, () => putHomebrewRow(old));
    expect(await stampOf('mine')).toBeUndefined();

    await homebrewRepo.saveEntry(
      'spell',
      { name: 'Ember Lance', source: 'EMB' },
      { fileId: 'mine' },
    );
    const stamp = await stampOf('mine');
    expect(stamp).toMatch(UUID);
    // The builder hands back the content it opened, from before the stamp.
    await homebrewRepo.saveEditable('mine', file('EMB', ['Ember Ward']));
    expect(await stampOf('mine')).toBe(stamp);
    // Nor does content carrying another id move it.
    await homebrewRepo.saveEditable('mine', withCollectionId(file('EMB'), 'another'));
    expect(await stampOf('mine')).toBe(stamp);
    await homebrewRepo.saveEntry(
      'spell',
      { name: 'Ember Bolt', source: 'EMB' },
      { fileId: 'mine' },
    );
    await homebrewRepo.removeEntry('mine', 'spell', { name: 'Ember Bolt', source: 'EMB' });
    expect(await stampOf('mine')).toBe(stamp);
  });

  it('keys the file it is in, wherever it is imported, so one player’s newer copy updates theirs', async () => {
    const first = withCollectionId(file('MyHomebrew', ['Osk Lance']), 'osk');
    const row = await homebrewRepo.importJson(first, 'My_homebrew.json');
    expect(row.key).toBe('made:osk');
    // Another player's Workshop file: one name and source, another id.
    const bram = withCollectionId(file('MyHomebrew', ['Bram Ward']), 'bram');
    await homebrewRepo.importJson(bram, 'My_homebrew.json');
    const newer = withCollectionId(file('MyHomebrew', ['Osk Lance', 'Osk Ward']), 'osk');
    const { replaced } = await homebrewRepo.commit(
      await homebrewRepo.prepare(newer, 'My_homebrew (1).json'),
    );
    expect(replaced.map((r) => r.id)).toEqual([row.id]);
    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => f.json)).toEqual(expect.arrayContaining([newer, bram]));
    expect(files).toHaveLength(2);
  });

  it('leaves a book that carries one keyed by its book', async () => {
    // One book of a converted compendium, as a file or a character's export brings it:
    // every book of a file has that file's `_meta`, so a stamp in it would be on all of them.
    const book = (source: string) =>
      withCollectionId(
        {
          _meta: {
            sources: [{ json: source, full: `${source} Book` }],
            convertedFrom: { format: 'fc5-compendium', fileName: 'compendium.xml' },
          },
          spell: [{ name: `${source} Lance`, source, level: 1 }],
        },
        'one-id',
      );
    const rows = await Promise.all(
      ['EMB', 'ASH'].map((s) => buildHomebrewRow(book(s), 'compendium.json')),
    );
    expect(rows.map((r) => [r.book, r.key])).toEqual([
      ['EMB Book', 'book:emb|compendium'],
      ['ASH Book', 'book:ash|compendium'],
    ]);
  });

  it('is missing from a file under the app’s source from before stamps, which lands beside', async () => {
    const workshop = (spells: string[]) => file('MyHomebrew', spells);
    const osk = await homebrewRepo.importJson(workshop(['Osk Lance']), 'My_homebrew.json');
    expect(osk).not.toHaveProperty('key');
    await homebrewRepo.importJson(workshop(['Bram Ward']), 'My_homebrew.json');
    const { files } = await homebrewRepo.listSafe();
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.key === undefined)).toBe(true);
  });

  it('lets a stamped file imported as a file take the place of its copy with no stamp', async () => {
    const old = await homebrewRepo.importJson(file('HB', ['Osk Lance']), 'Homebrew.json');
    const stamped = withCollectionId(file('HB', ['Osk Lance', 'Osk Ward']), 'osk');
    const { replaced, row } = await homebrewRepo.commit(
      await homebrewRepo.prepare(stamped, 'Homebrew (1).json'),
    );
    expect(replaced.map((r) => r.id)).toEqual([old.id]);
    expect(row.key).toBe('made:osk');
    expect((await homebrewRepo.listSafe()).files.map((f) => f.json)).toEqual([stamped]);
  });

  it('lets a stamped file take the place of its stamped copy and one with no stamp at once', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const first = await homebrewRepo.importJson(
      withCollectionId(file('HB', ['Osk Lance']), 'osk'),
      'Homebrew.json',
    );
    await homebrewRepo.setEnabled(first.id, false);
    now.mockReturnValue(2_000);
    // An older export with no stamp lands beside the stamped copy.
    await homebrewRepo.importJson(file('HB', ['Osk Old']), 'Homebrew.json');
    expect((await homebrewRepo.listSafe()).files).toHaveLength(2);
    now.mockReturnValue(9_000);

    const newer = withCollectionId(file('HB', ['Osk Lance', 'Osk Ward']), 'osk');
    const { replaced } = await homebrewRepo.commit(
      await homebrewRepo.prepare(newer, 'Homebrew.json'),
    );

    expect(replaced).toHaveLength(2);
    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => [f.json, f.enabled, f.addedAt])).toEqual([[newer, true, 1_000]]);
  });

  it('is missing from a file under a source the player chose, which is keyed as any file is', async () => {
    // Made before stamps, it looks like any other file here: a known gap, in the hand-over.
    await homebrewRepo.importJson(file('HB', ['Osk Lance']), 'Homebrew.json');
    await homebrewRepo.importJson(file('HB', ['Bram Ward']), 'Homebrew.json');
    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => f.json)).toEqual([file('HB', ['Bram Ward'])]);
  });
});

describe('the changes role', () => {
  it('is set by the app on the file of changes it makes on the first save, and kept', async () => {
    const fireball = { name: 'Fireball', source: 'PHB', level: 3 };
    const made = await homebrewRepo.saveEntry('spell', fireball, { role: 'changes' });
    const again = await homebrewRepo.saveEntry(
      'spell',
      { name: 'Aid', source: 'PHB', level: 2 },
      { role: 'changes' },
    );
    expect(made.created).toBe(true);
    expect(again).toEqual({ fileId: made.fileId, created: false });
    const changes = (await homebrewRepo.getSafe(made.fileId)).file;
    expect(changes?.role).toBe('changes');
    expect(changes?.sourceIds).toEqual(['MyChanges']);
    expect((changes?.json.spell as unknown[]).length).toBe(2);
    // The Workshop's own file is another, made apart from it.
    const workshop = await homebrewRepo.saveEntry('spell', {
      name: 'Ember Lance',
      source: 'MyHomebrew',
    });
    expect(workshop.fileId).not.toBe(made.fileId);
    expect((await homebrewRepo.getSafe(workshop.fileId)).file).not.toHaveProperty('role');
  });

  it('never comes from a file: an import claiming it stores none', async () => {
    const prepared = await homebrewRepo.prepare(file('EMB', ['Ember Lance']), 'ember.json');
    const { row } = await homebrewRepo.commit({ ...prepared, role: 'changes' });
    // On the stored row itself: the reader drops a role off an imported row anyway.
    expect(await db.homebrewFiles.get(row.id)).not.toHaveProperty('role');
  });
});

/** A database as version 5 left it, written by `fill`, and closed. */
async function oldDevice(fill: (old: Dexie) => Promise<void>): Promise<void> {
  db.close();
  await Dexie.delete('cast-guidance');
  const old = new Dexie('cast-guidance');
  old.version(5).stores(V5);
  await fill(old);
  old.close();
}

/** A pack's file with Apply to as version 5 kept it, written for the file `file`. */
function oldPack(file: string) {
  return {
    _meta: {
      sources: [{ json: 'GT', full: 'Gritty Table' }],
      castGuidance: { v: 1, tableRules: { restLength: 'gritty' } },
      castGuidanceLocal: { file, appliesTo: { characters: ['hild'] }, order: 2 },
    },
  };
}

describe('the version 6 upgrade', () => {
  it('writes no file content it takes nothing out of, so it needs no room for the books', async () => {
    const before = await homebrewRepo.prepare(file('EMB', ['Ember Lance']), 'ember.json');
    await oldDevice(async (old) => {
      const { json, key: _, ...meta } = before;
      await old.table('homebrewFiles').put(meta);
      await old.table('homebrewJson').put({ id: before.id, json });
    });
    // Any write of content during the upgrade fails, as on a device out of room.
    const fault = await injectIdbFault(db, { tables: ['homebrewJson'], ops: ['put'] });
    try {
      expect(fault.attempts).toBe(0);
      expect((await db.homebrewFiles.get(before.id))?.key).toBe('file:emb|ember');
    } finally {
      await fault();
    }
  });

  it('leaves Apply to written for another file in it, and takes one off a row version 5 missed', async () => {
    const elsewhere = { id: 'pack-a', json: oldPack('another-device') };
    const missed = { id: 'pack-b', json: oldPack('pack-b') };
    await oldDevice(async (old) => {
      for (const p of [elsewhere, missed]) {
        await old.table('homebrewFiles').put({
          id: p.id,
          fileName: `${p.id}.json`,
          enabled: true,
          editable: false,
          sourceIds: ['GT'],
          counts: {},
          addedAt: 1,
          // Version 5 moved content off every row, but a reader still takes it from one.
          ...(p === missed ? { json: p.json } : {}),
        });
      }
      await old.table('homebrewJson').put(elsewhere);
    });
    await db.open();
    const a = await db.homebrewFiles.get('pack-a');
    expect(a?.pack).toBeUndefined();
    expect((await db.homebrewJson.get('pack-a'))?.json).toEqual(oldPack('another-device'));
    const b = await db.homebrewFiles.get('pack-b');
    expect(b?.pack).toEqual({ appliesTo: { characters: ['hild'] }, order: 2 });
    expect((b?.json as { _meta: object })._meta).not.toHaveProperty('castGuidanceLocal');
  });

  it('gives a Workshop file another device made no key, so the next one lands beside it', async () => {
    const osk = await homebrewRepo.prepare(file('MyHomebrew', ['Osk Lance']), 'My_homebrew.json');
    await oldDevice(async (old) => {
      const { json, key: _, ...meta } = osk;
      await old.table('homebrewFiles').put(meta);
      await old.table('homebrewJson').put({ id: osk.id, json });
    });
    await db.open();
    expect(await db.homebrewFiles.get(osk.id)).not.toHaveProperty('key');

    await homebrewRepo.importJson(file('MyHomebrew', ['Bram Ward']), 'My_homebrew.json');
    expect((await homebrewRepo.listSafe()).files).toHaveLength(2);
  });

  it('keys a stamped file a device stored before it had keys by its stamp', async () => {
    // Made on a newer device and imported here before this one updated.
    const stamped = (source: string, id: string, spells: string[]) =>
      withCollectionId(file(source, spells), id);
    const osk = await homebrewRepo.prepare(
      stamped('MyHomebrew', 'osk', ['Osk Lance']),
      'My_homebrew.json',
    );
    const ember = await homebrewRepo.prepare(stamped('EMB', 'ember', ['Ember Lance']), 'e.json');
    const missed = await homebrewRepo.prepare(stamped('ASH', 'ash', ['Ash Ward']), 'a.json');
    await oldDevice(async (old) => {
      for (const r of [osk, ember]) {
        const { json, key: _, ...meta } = r;
        await old.table('homebrewFiles').put(meta);
        await old.table('homebrewJson').put({ id: r.id, json });
      }
      // A row version 5 left its content on.
      const { key: _, ...row } = missed;
      await old.table('homebrewFiles').put(row);
    });
    await db.open();
    expect((await db.homebrewFiles.get(osk.id))?.key).toBe('made:osk');
    expect((await db.homebrewFiles.get(ember.id))?.key).toBe('made:ember');
    expect((await db.homebrewFiles.get(missed.id))?.key).toBe('made:ash');

    const newer = stamped('MyHomebrew', 'osk', ['Osk Lance', 'Osk Ward']);
    const { replaced } = await homebrewRepo.commit(
      await homebrewRepo.prepare(newer, 'My_homebrew.json'),
    );
    expect(replaced.map((r) => r.id)).toEqual([osk.id]);
  });

  it('keys each imported file, so its first import again updates it', async () => {
    db.close();
    await Dexie.delete('cast-guidance');
    const old = new Dexie('cast-guidance');
    old.version(5).stores(V5);
    const before = await homebrewRepo.prepare(file('EMB', ['Ember Lance']), 'ember.json');
    const { json, key: _, ...meta } = before;
    await old.table('homebrewFiles').put({ ...meta, enabled: false, addedAt: 1_000 });
    await old.table('homebrewJson').put({ id: before.id, json });
    const mine = { ...meta, id: 'mine', fileName: 'Mine.json', editable: true };
    await old.table('homebrewFiles').put(mine);
    await old.table('homebrewJson').put({ id: 'mine', json });
    old.close();

    await db.open();
    expect((await db.homebrewFiles.get(before.id))?.key).toBe('file:emb|ember');
    expect((await db.homebrewFiles.get('mine'))?.key).toBeUndefined();

    const changed = file('EMB', ['Ember Lance', 'Ember Ward']);
    await homebrewRepo.importJson(changed, 'ember.json');
    const imported = (await homebrewRepo.listSafe()).files.filter((f) => !f.editable);
    expect(imported.map((f) => [f.json, f.enabled, f.addedAt])).toEqual([[changed, false, 1_000]]);
  });
});
