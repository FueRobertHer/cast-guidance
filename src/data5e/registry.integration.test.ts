// IndexedDB-backed integration test (TEST-002/003) for the registry rebuild
// that powers SEARCH-001: an editable-homebrew edit must change the registry
// signature (the search-index cache key) so results can't go stale.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { dataCacheRepo } from '@/db/dataCacheRepo';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { getActiveTag } from './loader';
import { getRegistry, invalidateRegistry, registrySignature } from './registry';

function brewJson(spellName: string) {
  return {
    _meta: { sources: [{ json: 'BRW', abbreviation: 'BRW', full: 'Brew' }] },
    spell: [{ name: spellName, source: 'BRW', level: 1 }],
  };
}

const spellNames = async () => (await getRegistry()).byType('spell').map((s) => String(s.name));

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  invalidateRegistry();
});

describe('registry rebuild on editable-homebrew edit', () => {
  it('changes the signature and content when a same-id file is edited', async () => {
    const brew = await homebrewRepo.createEditable('Brew', 'BRW');
    await homebrewRepo.saveEditable(brew.id, brewJson('Old Spell'));

    const namesBefore = await spellNames();
    const sigBefore = registrySignature();
    expect(namesBefore).toContain('Old Spell');

    // Edit the same file (stable id, bumped rev) — no invalidateRegistry():
    // the signature must change on its own so the rebuild happens.
    await homebrewRepo.saveEditable(brew.id, brewJson('New Spell'));
    const namesAfter = await spellNames();
    const sigAfter = registrySignature();

    expect(sigAfter).not.toBe(sigBefore);
    expect(namesAfter).toContain('New Spell');
    expect(namesAfter).not.toContain('Old Spell');
  });

  it('caches the registry when nothing changed (stable signature)', async () => {
    const brew = await homebrewRepo.createEditable('Brew', 'BRW');
    await homebrewRepo.saveEditable(brew.id, brewJson('Zap'));
    const first = await getRegistry();
    const second = await getRegistry();
    expect(second).toBe(first); // same instance — no needless rebuild
  });
});

describe('a homebrew row the app cannot read', () => {
  it('is left out of the registry instead of taking it down', async () => {
    // `mergeHomebrew` indexes into `json` directly, so a row whose content is
    // not an object threw a TypeError out of getRegistry(). That is not a
    // homebrew failure: every view needs the compendium, so the library, the
    // creator and every character sheet went down with the one bad row.
    const good = await homebrewRepo.createEditable('Brew', 'BRW');
    await homebrewRepo.saveEditable(good.id, brewJson('Zap'));
    await db.homebrewFiles.put({
      id: 'broken',
      fileName: 'broken.json',
      json: null,
      enabled: true,
      editable: false,
      sourceIds: ['BAD'],
      counts: {},
      addedAt: 2,
    } as never);
    invalidateRegistry();

    await expect(spellNames()).resolves.toContain('Zap');
  });
});

describe('registry rebuild as the background drain lands files', () => {
  const putDataFile = (path: string, json: unknown) =>
    dataCacheRepo.putFile({
      key: dataCacheRepo.key(getActiveTag(), path),
      tag: getActiveTag(),
      path,
      pack: 'essentials',
      json,
      bytes: 0,
      fetchedAt: 1,
    });

  it('picks up a file that arrives after the first build', async () => {
    // The signature is now read from cached primary keys rather than from the
    // rows themselves. If those two ever disagreed the registry would go stale
    // for the whole session, which is the one thing that change could break:
    // the drain adds files for seconds after the first page paints.
    await putDataFile('feats.json', { feat: [{ name: 'Alert', source: 'PHB' }] });
    const first = await getRegistry();
    expect(first.byType('feat').map((f) => String(f.name))).toEqual(['Alert']);

    await putDataFile('backgrounds.json', { background: [{ name: 'Sage', source: 'PHB' }] });
    const second = await getRegistry();
    expect(second).not.toBe(first);
    expect(second.byType('background').map((b) => String(b.name))).toEqual(['Sage']);
    expect(second.byType('feat').map((f) => String(f.name))).toEqual(['Alert']);
  });
});
