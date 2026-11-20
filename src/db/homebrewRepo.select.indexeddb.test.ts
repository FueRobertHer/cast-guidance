// Taking several of the player's entries out at once, and Undo (ADR-002 board 9,
// phase U8): one write over every file, each entry back in its place, the
// characters never touched.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import { db } from './db';
import { homebrewRepo } from './homebrewRepo';

type Row = Record<string, unknown>;

afterEach(async () => {
  await db.homebrewFiles.clear();
  await db.homebrewJson.clear();
  await db.characters.clear();
});

const content = async (id: string) => (await db.homebrewJson.get(id))?.json as Row;
const rev = async (id: string) => (await db.homebrewFiles.get(id))?.rev ?? 0;

/** A collection of the player's holding `extra`. */
async function collection(name: string, source: string, extra: Row): Promise<string> {
  const row = await homebrewRepo.createEditable(name, source);
  await homebrewRepo.saveEditable(row.id, { ...(row.json as Row), ...extra });
  return row.id;
}

const spell = (name: string, source: string) => ({ name, source, level: 1, entries: [name] });

const LANTERN = {
  spell: [spell('Glimmer', 'HB'), spell('Lantern Light', 'HB'), spell('Dim', 'HB')],
  subclass: [{ name: 'Lantern Blood', shortName: 'Lantern', source: 'HB', className: 'Sorcerer' }],
  subclassFeature: [
    {
      name: 'Lamp Heart',
      source: 'HB',
      className: 'Sorcerer',
      subclassShortName: 'Lantern',
      subclassSource: 'HB',
      level: 1,
      entries: ['Bright.'],
    },
  ],
};

describe('removeEntries and restoreEntries', () => {
  it('takes entries out of two files in one write and Undo puts each back in its place', async () => {
    const lantern = await collection('Lantern Coast', 'HB', LANTERN);
    const tide = await collection('Tidewater', 'TW', { feat: [{ name: 'Gift', source: 'TW' }] });
    const doc = newCharacterDoc('sparks', 'Sparks', 'tag');
    doc.feats = [{ ref: { name: 'Gift', source: 'TW' }, instanceId: 'gift' }];
    doc.spellcasting = {
      'sorcerer|tst': { known: [{ name: 'Lantern Light', source: 'HB' }], prepared: [] },
    };
    await db.characters.put({ ...doc, revision: 'r1' });
    const before = { lantern: await content(lantern), tide: await content(tide) };
    const character = await db.characters.get('sparks');

    const removed = await homebrewRepo.removeEntries([
      { fileId: lantern, type: 'spell', key: { name: 'lantern light', source: 'hb' } },
      { fileId: lantern, type: 'subclass', key: { name: 'Lantern Blood', source: 'HB' } },
      { fileId: tide, type: 'feat', key: { name: 'Gift', source: 'TW' } },
    ]);

    const after = await content(lantern);
    expect((after.spell as Row[]).map((s) => s.name)).toEqual(['Glimmer', 'Dim']);
    // A subclass goes with its own features.
    expect(after.subclass).toEqual([]);
    expect(after.subclassFeature).toEqual([]);
    expect((await content(tide)).feat).toEqual([]);
    expect(removed.files.map((f) => f.id).sort()).toEqual([lantern, tide].sort());
    expect(removed.files.find((f) => f.id === lantern)?.rev).toBe(await rev(lantern));
    // Characters keep what they hold, so Undo puts it back on their sheets.
    expect(await db.characters.get('sparks')).toEqual(character);

    await homebrewRepo.restoreEntries(removed);
    expect(await content(lantern)).toEqual(before.lantern);
    expect(await content(tide)).toEqual(before.tide);
    expect(await db.characters.get('sparks')).toEqual(character);
  });

  it('refuses the lot when one entry is no longer there, changing nothing', async () => {
    const lantern = await collection('Lantern Coast', 'HB', LANTERN);
    const tide = await collection('Tidewater', 'TW', { feat: [{ name: 'Gift', source: 'TW' }] });
    const before = { lantern: await content(lantern), tide: await content(tide) };
    await expect(
      homebrewRepo.removeEntries([
        { fileId: tide, type: 'feat', key: { name: 'Gift', source: 'TW' } },
        { fileId: lantern, type: 'spell', key: { name: 'Nowhere', source: 'HB' } },
      ]),
    ).rejects.toThrow('Nowhere is no longer in');
    expect(await content(lantern)).toEqual(before.lantern);
    expect(await content(tide)).toEqual(before.tide);
  });

  it('refuses Undo once a file has changed since, and puts back no file at all', async () => {
    const lantern = await collection('Lantern Coast', 'HB', LANTERN);
    const tide = await collection('Tidewater', 'TW', { feat: [{ name: 'Gift', source: 'TW' }] });
    const removed = await homebrewRepo.removeEntries([
      { fileId: lantern, type: 'spell', key: { name: 'Dim', source: 'HB' } },
      { fileId: tide, type: 'feat', key: { name: 'Gift', source: 'TW' } },
    ]);
    await homebrewRepo.saveEntry('spell', spell('Later', 'TW'), { fileId: tide });
    const now = { lantern: await content(lantern), tide: await content(tide) };
    await expect(homebrewRepo.restoreEntries(removed)).rejects.toThrow('changed since');
    expect(await content(lantern)).toEqual(now.lantern);
    expect(await content(tide)).toEqual(now.tide);

    await homebrewRepo.delete(tide);
    await expect(homebrewRepo.restoreEntries(removed)).rejects.toThrow('no longer on this device');
  });

  it('finds a change to the books by its parents too', async () => {
    const hill = (raceName: string) => ({
      name: 'Hill',
      source: 'PHB',
      raceName,
      raceSource: 'PHB',
      speed: 30,
    });
    await homebrewRepo.saveEntry('subrace', hill('Dwarf'), { role: 'changes' });
    const { fileId } = await homebrewRepo.saveEntry('subrace', hill('Gnome'), { role: 'changes' });
    const before = await content(fileId);
    const removed = await homebrewRepo.removeEntries([
      { fileId, type: 'subrace', key: { ...hill('Gnome') } },
    ]);
    expect((await content(fileId)).subrace).toEqual([hill('Dwarf')]);
    await homebrewRepo.restoreEntries(removed);
    expect(await content(fileId)).toEqual(before);
  });
});
