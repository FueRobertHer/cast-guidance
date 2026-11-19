// A collection keeps its identity (ADR-002, D4): a file imported again with
// its key updates the collection it was, and a collection made in the app has
// a source of its own. Real repository over fake-indexeddb.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectIdbFault } from '../../tests-fixtures/idbFaults';
import { db } from './db';
import { homebrewRepo, putHomebrewRow } from './homebrewRepo';

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
