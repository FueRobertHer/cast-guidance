// An imported collection copied into one the player owns (track 7): the copy
// is its own collection, under books of its own, and the file it came from
// stays as it was, for the characters on it and for its next import.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DATA_TAG } from '@/data5e/config';
import { getRegistry, invalidateRegistry } from '@/data5e/registry';
import { db } from './db';
import { COLLECTION_ID_KEY } from './homebrewOrder';
import { homebrewRepo } from './homebrewRepo';

type Json = Record<string, unknown>;

const ember = (bolt = 'A bolt.'): Json => ({
  _meta: {
    sources: [{ json: 'EMB', abbreviation: 'EMB', full: 'Ember Codex' }],
    convertedFrom: { format: 'fc5-compendium', fileName: 'embers.xml' },
  },
  spell: [
    { name: 'Ember Bolt', source: 'EMB', level: 1, entries: [bolt] },
    { name: 'Ember Ward', source: 'EMB', level: 2, entries: ['As {@spell Ember Bolt|EMB}.'] },
  ],
});

const content = async (id: string) =>
  (await homebrewRepo.listSafe()).files.find((f) => f.id === id)?.json ?? {};

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.settings.put({ key: 'dataTag', value: DATA_TAG });
  invalidateRegistry();
});

describe('homebrewRepo.copyEditable', () => {
  it('makes a collection of the player’s own, under books of its own', async () => {
    const original = await homebrewRepo.importJson(ember(), 'embers.json');
    const copy = await homebrewRepo.copyEditable(original.id);

    expect(copy).toMatchObject({ editable: true, enabled: true, sourceIds: ['EMB2'] });
    expect(copy.id).not.toBe(original.id);
    const meta = copy.json._meta as Json;
    expect(meta.sources).toEqual([
      { json: 'EMB2', abbreviation: 'EMB2', full: 'Ember Codex (copy)' },
    ]);
    // Its own stamp, and nothing that would take it for the converted file.
    expect(typeof meta[COLLECTION_ID_KEY]).toBe('string');
    expect(meta.convertedFrom).toBeUndefined();
    expect(copy.json.spell).toEqual([
      { name: 'Ember Bolt', source: 'EMB2', level: 1, entries: ['A bolt.'] },
      { name: 'Ember Ward', source: 'EMB2', level: 2, entries: ['As {@spell Ember Bolt|EMB2}.'] },
    ]);
    // The original is as it was.
    expect(await content(original.id)).toEqual(original.json);
    expect((await homebrewRepo.ownedSafe()).files.map((f) => f.id)).toEqual([copy.id]);
  });

  it('shows an edit to the copy, beside the original', async () => {
    const original = await homebrewRepo.importJson(ember(), 'embers.json');
    const copy = await homebrewRepo.copyEditable(original.id);
    await homebrewRepo.saveEntry(
      'spell',
      { name: 'Ember Bolt', source: 'EMB2', level: 3, entries: ['A bigger bolt.'] },
      { fileId: copy.id, replaces: { name: 'Ember Bolt', source: 'EMB2' } },
    );
    invalidateRegistry();
    const reg = await getRegistry();
    expect(reg.get('spell', 'Ember Bolt', 'EMB2')?.level).toBe(3);
    expect(reg.get('spell', 'Ember Bolt', 'EMB')?.level).toBe(1);
  });

  it('leaves the copy alone when the original is imported again', async () => {
    const original = await homebrewRepo.importJson(ember(), 'embers.json');
    const copy = await homebrewRepo.copyEditable(original.id);
    const update = await homebrewRepo.importJson(ember('A newer bolt.'), 'embers.json');

    const files = (await homebrewRepo.listSafe()).files;
    expect(files.map((f) => f.id).sort()).toEqual([copy.id, update.id].sort());
    expect(files.find((f) => f.id === original.id)).toBeUndefined();
    expect(await content(copy.id)).toEqual(copy.json);
  });

  it('takes a free id for each book, past ones already here', async () => {
    await homebrewRepo.createEditable('Taken', 'EMB2');
    const original = await homebrewRepo.importJson(
      {
        _meta: {
          sources: [
            { json: 'EMB', full: 'Ember Codex' },
            { json: 'FRC', full: 'Frost Codex' },
          ],
        },
        spell: [
          { name: 'Ember Bolt', source: 'EMB', level: 1 },
          { name: 'Frost Bolt', source: 'FRC', level: 1, classes: { fromClassList: [] } },
        ],
      },
      'two.json',
    );
    const copy = await homebrewRepo.copyEditable(original.id);
    expect(copy.sourceIds).toEqual(['EMB3', 'FRC2']);
    expect((copy.json.spell as Json[]).map((s) => s.source)).toEqual(['EMB3', 'FRC2']);
  });

  it('refuses a collection of the player’s own, a rule pack, and one that is gone', async () => {
    const own = await homebrewRepo.createEditable('Mine', 'MINE');
    await expect(homebrewRepo.copyEditable(own.id)).rejects.toThrow(/yours to change already/);
    const pack = await homebrewRepo.importJson(
      {
        _meta: { sources: [{ json: 'RP', full: 'Rule Pack' }] },
        castGuidance: { name: 'Pack', tableRules: { crits: 'maxDice' } },
      },
      'pack.json',
    );
    await expect(homebrewRepo.copyEditable(pack.id)).rejects.toThrow(/rule pack/);
    await expect(homebrewRepo.copyEditable('nothing')).rejects.toThrow(/no longer on this device/);
  });
});
