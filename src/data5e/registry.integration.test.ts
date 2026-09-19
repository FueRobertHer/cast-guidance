// IndexedDB-backed integration test (TEST-002/003) for the registry rebuild
// that powers SEARCH-001: an editable-homebrew edit must change the registry
// signature (the search-index cache key) so results can't go stale.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataCacheRepo } from '@/db/dataCacheRepo';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { getActiveTag } from './loader';
import {
  getRegistry,
  invalidateRegistry,
  isRegistryRefreshing,
  registrySignature,
  subscribeRegistryRefreshing,
} from './registry';

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
    // A row whose content is not an object threw a TypeError out of
    // getRegistry(), so the library, the creator and every character sheet
    // went down with it. That is not a homebrew failure.
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

describe('a rebuild that spans an invalidation', () => {
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

  it('does not publish what it read before the data changed underneath it', async () => {
    // Reading every cached row is the slow part of a rebuild, and the drain
    // keeps starting rebuilds while someone is browsing. One that begins
    // before a repair and finishes after it holds the pre-repair bodies, and
    // publishing them installs the old data under a signature that says it is
    // current. A repair changes bodies and no paths, so that signature matches
    // the next request exactly: the repair is undone and cannot be retried,
    // because nothing is missing and nothing has changed.
    await putDataFile('races.json', { race: [] });
    await getRegistry();

    // A new path, so the next request really rebuilds rather than short-circuits.
    await putDataFile('feats.json', { feat: [] });

    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hasRead = (): void => undefined;
    const read = new Promise<void>((resolve) => {
      hasRead = resolve;
    });
    const realFilesByTag = dataCacheRepo.filesByTag.bind(dataCacheRepo);
    const spy = vi.spyOn(dataCacheRepo, 'filesByTag').mockImplementationOnce(async (tag) => {
      const rows = await realFilesByTag(tag); // the rows as they are now
      hasRead();
      await held; // ...published only after the repair has landed
      return rows;
    });

    const spanning = getRegistry();
    // Not before the rows are in hand, or there is no stale read to publish.
    await read;
    await putDataFile('races.json', { race: [{ name: 'Elf', source: 'PHB' }] });
    invalidateRegistry();
    release();
    await spanning;
    spy.mockRestore();

    const after = await getRegistry();
    expect(after.get('race', 'Elf')).toBeDefined();
  });
});

describe('the rebuild-in-flight signal', () => {
  // Registered subscribers are module state: one left behind by a test that
  // threw before its own cleanup would go on firing for the rest of the file.
  const subscribed: Array<() => void> = [];
  const listen = (fn: () => void) => {
    subscribed.push(subscribeRegistryRefreshing(fn));
  };
  afterEach(() => {
    for (const off of subscribed.splice(0)) off();
  });

  it('is raised for as long as a read is running, and told to whoever asked', async () => {
    // The library reads this to tell "not in the data" from "not in the data
    // yet". It lives on the registry rather than in each component's state
    // because it moves once per file a background drain lands, and every page
    // holding its own copy re-rendered twice for each one.
    expect(isRegistryRefreshing()).toBe(false);

    const seen: boolean[] = [];
    listen(() => seen.push(isRegistryRefreshing()));

    const reading = getRegistry();
    expect(isRegistryRefreshing()).toBe(true);
    await reading;
    expect(isRegistryRefreshing()).toBe(false);

    expect(seen).toEqual([true, false]);
  });

  it('stays raised until the last of several overlapping reads is done', async () => {
    // Every page mounts its own registry hook, so reads overlap constantly.
    // Dropping the flag when the first of them finishes would call the
    // registry current while another was still rebuilding it.
    const seen: boolean[] = [];
    listen(() => seen.push(isRegistryRefreshing()));

    const reads = [getRegistry(), getRegistry(), getRegistry()];
    expect(isRegistryRefreshing()).toBe(true);
    // One transition each way, however many readers there were.
    expect(seen).toEqual([true]);

    await Promise.all(reads);
    expect(isRegistryRefreshing()).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('comes back down when a read throws', async () => {
    const spy = vi
      .spyOn(dataCacheRepo, 'cachedPaths')
      .mockRejectedValueOnce(new Error('QuotaExceededError'));

    await expect(getRegistry()).rejects.toThrow('QuotaExceededError');
    expect(isRegistryRefreshing()).toBe(false);
    spy.mockRestore();
  });

  it('stops telling a subscriber that unsubscribed', async () => {
    let told = 0;
    const unsubscribe = subscribeRegistryRefreshing(() => told++);
    unsubscribe();

    await getRegistry();
    expect(told).toBe(0);
  });
});
