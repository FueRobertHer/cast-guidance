// The Workshop's saves into the player's own homebrew file (TEST-002 harness).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { EntryClash, homebrewRepo, WORKSHOP_SOURCE } from './homebrewRepo';

const feat = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  source: WORKSHOP_SOURCE,
  entries: [`${name} helps.`],
  ...extra,
});

async function stored(fileId: string) {
  const file = (await homebrewRepo.ownedSafe()).files.find((f) => f.id === fileId);
  return file?.json;
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('homebrewRepo.saveEntry', () => {
  it('makes the Workshop file on the first save, and saves into it after', async () => {
    const first = await homebrewRepo.saveEntry('feat', feat('Steady'));
    expect(first.created).toBe(true);
    const second = await homebrewRepo.saveEntry('race', { ...feat('Stonefolk'), speed: 30 });
    expect(second).toEqual({ fileId: first.fileId, created: false });

    const row = await db.homebrewFiles.get(first.fileId);
    expect(row).toMatchObject({ editable: true, sourceIds: [WORKSHOP_SOURCE], enabled: true });
    expect(row?.counts).toEqual({ feat: 1, race: 1 });
    const json = await stored(first.fileId);
    expect(json?.feat).toEqual([feat('Steady')]);
    expect(json?._meta).toMatchObject({
      sources: [{ json: WORKSHOP_SOURCE, full: 'My homebrew' }],
    });
  });

  it('replaces the entry it opened, renamed or not, and bumps the revision', async () => {
    const { fileId } = await homebrewRepo.saveEntry('feat', feat('Steady'));
    const rev = (await db.homebrewFiles.get(fileId))?.rev ?? 0;
    const opened = { name: 'Steady', source: WORKSHOP_SOURCE };
    await homebrewRepo.saveEntry('feat', feat('Steady', { repeatable: true }), {
      replaces: opened,
    });
    expect((await stored(fileId))?.feat).toEqual([feat('Steady', { repeatable: true })]);
    await homebrewRepo.saveEntry('feat', feat('Steadfast'), {
      fileId,
      replaces: { name: 'steady', source: WORKSHOP_SOURCE },
    });
    expect((await stored(fileId))?.feat).toEqual([feat('Steadfast')]);
    expect((await db.homebrewFiles.get(fileId))?.rev).toBeGreaterThan(rev);
  });

  it('never lets a new entry or a fresh copy overwrite one with its name', async () => {
    const { fileId } = await homebrewRepo.saveEntry('feat', feat('Alert'));
    await expect(
      homebrewRepo.saveEntry('feat', feat('ALERT', { repeatable: true })),
    ).rejects.toBeInstanceOf(EntryClash);
    expect((await stored(fileId))?.feat).toEqual([feat('Alert')]);
  });

  it('refuses a rename onto a neighbour, and changes nothing', async () => {
    const { fileId } = await homebrewRepo.saveEntry('feat', feat('Steady'));
    await homebrewRepo.saveEntry('feat', feat('Bold'));
    await expect(
      homebrewRepo.saveEntry('feat', feat('Bold', { repeatable: true }), {
        fileId,
        replaces: { name: 'Steady', source: WORKSHOP_SOURCE },
      }),
    ).rejects.toBeInstanceOf(EntryClash);
    expect((await stored(fileId))?.feat).toEqual([feat('Steady'), feat('Bold')]);
  });

  it('saves into another file the player owns, and never into an imported one', async () => {
    const own = await homebrewRepo.createEditable('Swamp', 'SWP');
    await homebrewRepo.saveEntry(
      'feat',
      { ...feat('Bog Sense'), source: 'SWP' },
      { fileId: own.id },
    );
    expect((await stored(own.id))?.feat).toEqual([{ ...feat('Bog Sense'), source: 'SWP' }]);

    const imported = await homebrewRepo.importJson(
      { _meta: { sources: [{ json: 'IMP', abbreviation: 'IMP', full: 'Imported' }] } },
      'imp.json',
    );
    await expect(
      homebrewRepo.saveEntry('feat', feat('Nope'), { fileId: imported.id }),
    ).rejects.toThrow('that file was imported, so it cannot be changed here');
    await expect(homebrewRepo.saveEntry('feat', feat('Nope'), { fileId: 'gone' })).rejects.toThrow(
      'that homebrew file is no longer on this device',
    );
    // The Workshop file was never made for the refused saves.
    expect((await homebrewRepo.ownedSafe()).files.map((f) => f.sourceIds[0])).toEqual(['SWP']);
  });
});

describe('homebrewRepo.removeEntry', () => {
  it('takes one entry out, and says when it was not there', async () => {
    const { fileId } = await homebrewRepo.saveEntry('feat', feat('Steady'));
    await homebrewRepo.saveEntry('feat', feat('Bold'));
    expect(
      await homebrewRepo.removeEntry(fileId, 'feat', { name: 'STEADY', source: WORKSHOP_SOURCE }),
    ).toBe(true);
    expect((await stored(fileId))?.feat).toEqual([feat('Bold')]);
    expect((await db.homebrewFiles.get(fileId))?.counts).toEqual({ feat: 1 });
    expect(
      await homebrewRepo.removeEntry(fileId, 'feat', { name: 'Steady', source: WORKSHOP_SOURCE }),
    ).toBe(false);
  });
});
