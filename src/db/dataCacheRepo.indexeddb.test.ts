import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { dataCacheRepo } from './dataCacheRepo';
import { type DataFileRow, db } from './db';

function fileRow(tag: string, path: string, pack = 'essentials'): DataFileRow {
  return {
    key: dataCacheRepo.key(tag, path),
    tag,
    path,
    pack,
    json: { path },
    bytes: 0,
    fetchedAt: 1,
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('dataCacheRepo files', () => {
  it('round-trips a file by tag:path key', async () => {
    await dataCacheRepo.putFile(fileRow('v1', 'races.json'));
    const got = await dataCacheRepo.getFile('v1', 'races.json');
    expect(got?.json).toEqual({ path: 'races.json' });
    expect(await dataCacheRepo.getFile('v1', 'missing.json')).toBeUndefined();
  });

  it('lists cached paths and rows scoped to a tag', async () => {
    await dataCacheRepo.putFile(fileRow('v1', 'a.json'));
    await dataCacheRepo.putFile(fileRow('v1', 'b.json'));
    await dataCacheRepo.putFile(fileRow('v2', 'a.json'));
    expect([...(await dataCacheRepo.cachedPaths('v1'))].sort()).toEqual(['a.json', 'b.json']);
    expect(await dataCacheRepo.filesByTag('v2')).toHaveLength(1);
  });

  it('deleteTag removes only that tag’s files', async () => {
    await dataCacheRepo.putFile(fileRow('v1', 'a.json'));
    await dataCacheRepo.putFile(fileRow('v2', 'a.json'));
    await dataCacheRepo.deleteTag('v1');
    expect(await dataCacheRepo.filesByTag('v1')).toHaveLength(0);
    expect(await dataCacheRepo.filesByTag('v2')).toHaveLength(1);
  });
});

describe('dataCacheRepo meta', () => {
  it('markPackComplete accumulates packs for a tag', async () => {
    await dataCacheRepo.markPackComplete('v1', 'essentials');
    await dataCacheRepo.markPackComplete('v1', 'items-full');
    await dataCacheRepo.markPackComplete('v1', 'essentials'); // idempotent
    expect((await dataCacheRepo.getMeta())?.completedPacks).toEqual(['essentials', 'items-full']);
  });

  it('resets completedPacks when the tag changes', async () => {
    await dataCacheRepo.markPackComplete('v1', 'essentials');
    await dataCacheRepo.markPackComplete('v2', 'spells:phb');
    const meta = await dataCacheRepo.getMeta();
    expect(meta?.tag).toBe('v2');
    expect(meta?.completedPacks).toEqual(['spells:phb']);
  });
});
