// A character import brings its files in the way a homebrew import does
// (ADR-002, D4): a file of a collection here updates it in place. Real
// repository over fake-indexeddb.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import { CHARACTER_EXPORT_FORMAT } from '@/lib/guards';
import { characterRepo } from './characterRepo';
import { db } from './db';
import { homebrewRepo } from './homebrewRepo';

function brewFile(spells: string[]) {
  return {
    _meta: { sources: [{ json: 'EMB', abbreviation: 'EMB', full: 'Ember Book' }] },
    spell: spells.map((name) => ({ name, source: 'EMB', level: 1 })),
  };
}

function exportText(id: string, homebrew: unknown[]): string {
  const character = newCharacterDoc(id, 'Osk', 'tag');
  return JSON.stringify({ $format: CHARACTER_EXPORT_FORMAT, character, homebrew });
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a character import of a file of a collection here', () => {
  it('updates that collection, keeping its switch, its place and who it applies to', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const first = await homebrewRepo.importJson(brewFile(['Ember Lance']), 'ember.json');
    await homebrewRepo.setEnabled(first.id, false);
    await homebrewRepo.setPackLocal(first.id, () => ({ appliesTo: { characters: ['osk'] } }));
    now.mockReturnValue(9_000);
    const changed = brewFile(['Ember Lance', 'Ember Ward']);

    const summary = await characterRepo.importFromText(
      exportText('osk', [{ fileName: 'ember.json', json: changed }]),
    );

    expect(summary).toMatchObject({ homebrewAdded: 1, homebrewUpdated: 1, homebrewSkipped: 0 });
    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => [f.json, f.enabled, f.addedAt, f.pack])).toEqual([
      [changed, false, 1_000, { appliesTo: { characters: ['osk'] } }],
    ]);
  });

  it('keeps every copy the export carries, so every entry the character came with', async () => {
    // Two copies side by side on the device it came from, one of them here as it is.
    const both = brewFile(['Ember Lance', 'Ember Old']);
    const sibling = brewFile(['Ember Lance', 'Ember Ward']);
    await homebrewRepo.importJson(both, 'ember.json');
    const summary = await characterRepo.importFromText(
      exportText('osk', [
        { fileName: 'ember.json', json: both },
        { fileName: 'ember (1).json', json: sibling },
      ]),
    );
    expect(summary).toMatchObject({ homebrewAdded: 1, homebrewSkipped: 1 });
    expect(summary).not.toHaveProperty('homebrewUpdated');
    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => f.json)).toEqual(expect.arrayContaining([both, sibling]));
    expect(files).toHaveLength(2);
  });

  it('updates a copy here the export does not carry once, landing its other copies beside', async () => {
    await homebrewRepo.importJson(brewFile(['Ember Lance']), 'ember.json');
    const a = brewFile(['Ember Lance', 'Ember Old']);
    const b = brewFile(['Ember Lance', 'Ember Ward']);
    const summary = await characterRepo.importFromText(
      exportText('osk', [
        { fileName: 'ember.json', json: a },
        { fileName: 'ember (1).json', json: b },
      ]),
    );
    expect(summary).toMatchObject({ homebrewAdded: 2, homebrewUpdated: 1 });
    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => f.json)).toEqual(expect.arrayContaining([a, b]));
    expect(files).toHaveLength(2);
  });

  it('leaves the same file, and a file the player owns, as they were', async () => {
    await homebrewRepo.importJson(brewFile(['Ember Lance']), 'ember.json');
    const same = await characterRepo.importFromText(
      exportText('osk', [{ fileName: 'ember.json', json: brewFile(['Ember Lance']) }]),
    );
    expect(same).toMatchObject({ homebrewAdded: 0, homebrewSkipped: 1 });
    expect(same).not.toHaveProperty('homebrewUpdated');

    await homebrewRepo.saveEntry('spell', { name: 'Ash Bolt', source: 'MyHomebrew', level: 1 });
    const theirs = (await homebrewRepo.ownedSafe()).files[0];
    if (theirs === undefined) throw new Error('no Workshop file');
    const copy = { ...theirs.json, spell: [{ name: 'Other', source: 'MyHomebrew', level: 2 }] };
    await characterRepo.importFromText(
      exportText('bram', [{ fileName: theirs.fileName, json: copy }]),
    );
    expect((await homebrewRepo.getSafe(theirs.id)).file?.json).toEqual(theirs.json);
    expect((await homebrewRepo.listSafe()).files).toHaveLength(3);
  });
});
