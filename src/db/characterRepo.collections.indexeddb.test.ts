// A character import brings its files in the way a homebrew import does
// (ADR-002, D4): a file of a collection here updates it in place. Real
// repository over fake-indexeddb.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import { type HomebrewExportDTO, homebrewForExport } from '@/features/characters/homebrewExport';
import { CHARACTER_EXPORT_FORMAT } from '@/lib/guards';
import { characterRepo } from './characterRepo';
import { db, type HomebrewFileRow } from './db';
import { COLLECTION_ID_KEY } from './homebrewOrder';
import { homebrewRepo, putHomebrewRow, WORKSHOP_SOURCE } from './homebrewRepo';

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

const wipe = () => Promise.all(db.tables.map((t) => t.clear()));

beforeEach(wipe);

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

/** A spell the player saves in their Workshop file, as the Workshop saves one. */
const spell = (name: string) => ({ name, source: WORKSHOP_SOURCE, level: 1 });

/**
 * A character export from this device, its homebrew chosen and shaped as
 * `exportCharacter` does it: the files the character uses, as they leave it.
 */
async function exported(id: string): Promise<string> {
  const character = { ...newCharacterDoc(id, id, 'tag'), homebrewDeps: [WORKSHOP_SOURCE] };
  const homebrew: HomebrewExportDTO[] = homebrewForExport(
    character,
    (await homebrewRepo.enabledSafe()).files,
  );
  return JSON.stringify({ $format: CHARACTER_EXPORT_FORMAT, character, homebrew });
}

/** The Workshop's file as a device made it before files were stamped: no id in it. */
async function unstampedWorkshopFile(spells: string[]): Promise<string> {
  const row: HomebrewFileRow = {
    id: crypto.randomUUID(),
    fileName: 'My_homebrew.json',
    json: {
      _meta: {
        sources: [{ json: WORKSHOP_SOURCE, abbreviation: WORKSHOP_SOURCE, full: 'My homebrew' }],
      },
      spell: spells.map(spell),
    },
    enabled: true,
    editable: true,
    sourceIds: [WORKSHOP_SOURCE],
    counts: { spell: spells.length },
    addedAt: 1,
  };
  await db.transaction('rw', db.homebrewFiles, db.homebrewJson, () => putHomebrewRow(row));
  return row.id;
}

const spellsOf = (f: { json: Record<string, unknown> }) =>
  (f.json.spell as { name: string }[]).map((s) => s.name);

describe('a collection made in the app, in a character export (ADR-002, D4)', () => {
  it('is its maker’s alone: a DM who imports Osk, then Bram, keeps both their Workshop files', async () => {
    await homebrewRepo.saveEntry('spell', spell('Osk Lance'));
    const osk = await exported('osk');
    await wipe();
    await homebrewRepo.saveEntry('spell', spell('Bram Ward'));
    const bram = await exported('bram');
    await wipe();

    await characterRepo.importFromText(osk);
    const summary = await characterRepo.importFromText(bram);

    expect(summary).toMatchObject({ homebrewAdded: 1 });
    expect(summary).not.toHaveProperty('homebrewUpdated');
    const { files } = await homebrewRepo.listSafe();
    expect(files.map(spellsOf).sort()).toEqual([['Bram Ward'], ['Osk Lance']]);
  });

  it('updates its maker’s older copy in place when a newer one comes from them', async () => {
    await homebrewRepo.saveEntry('spell', spell('Osk Lance'));
    const before = await exported('osk');
    await homebrewRepo.saveEntry('spell', spell('Osk Ward'));
    const after = await exported('osk');
    await wipe();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await characterRepo.importFromText(before);
    const [first] = (await homebrewRepo.listSafe()).files;
    await homebrewRepo.setEnabled(first?.id ?? '', false);
    now.mockReturnValue(9_000);

    const summary = await characterRepo.importFromText(after);

    expect(summary).toMatchObject({ homebrewAdded: 1, homebrewUpdated: 1 });
    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => [spellsOf(f), f.enabled, f.addedAt])).toEqual([
      [['Osk Lance', 'Osk Ward'], false, 1_000],
    ]);
  });

  it('lands beside every other when made before files had an id, until its next save stamps it', async () => {
    const id = await unstampedWorkshopFile(['Osk Lance']);
    const old = await exported('osk');
    // Its next save on the device that made it stamps it, and every save after keeps the id.
    await homebrewRepo.saveEntry('spell', spell('Osk Ward'), { fileId: id });
    const stamped = await exported('osk');
    await homebrewRepo.saveEntry('spell', spell('Osk Bolt'), { fileId: id });
    const newer = await exported('osk');
    await wipe();
    await unstampedWorkshopFile(['Bram Ward']);
    const bram = await exported('bram');
    await wipe();

    await characterRepo.importFromText(old);
    // Another player's file made before ids lands beside it.
    expect(await characterRepo.importFromText(bram)).not.toHaveProperty('homebrewUpdated');
    // So does the maker's first stamped copy: the copy here has no id to match it by.
    expect(await characterRepo.importFromText(stamped)).not.toHaveProperty('homebrewUpdated');
    // The copy after it has its id, so it updates that one.
    expect(await characterRepo.importFromText(newer)).toMatchObject({ homebrewUpdated: 1 });

    const { files } = await homebrewRepo.listSafe();
    expect(files.map(spellsOf).sort()).toEqual([
      ['Bram Ward'],
      ['Osk Lance'],
      ['Osk Lance', 'Osk Ward', 'Osk Bolt'],
    ]);
    const ids = files.map((f) => (f.json._meta as Record<string, unknown>)[COLLECTION_ID_KEY]);
    expect(ids.filter((v) => v !== undefined)).toHaveLength(1);
  });
});
