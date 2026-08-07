import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { dataCacheRepo } from './dataCacheRepo';
import { type DataFileRow, db } from './db';

function fileRow(tag: string, path: string, pack = 'essentials', bytes = 0): DataFileRow {
  return {
    key: dataCacheRepo.key(tag, path),
    tag,
    path,
    pack,
    json: { path },
    bytes,
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

  it('deleteOtherTags keeps only the active tag', async () => {
    await dataCacheRepo.putFile(fileRow('v1', 'a.json'));
    await dataCacheRepo.putFile(fileRow('v2', 'a.json'));
    await dataCacheRepo.putFile(fileRow('v3', 'a.json'));
    await dataCacheRepo.deleteOtherTags('v2');
    expect(await dataCacheRepo.filesByTag('v1')).toHaveLength(0);
    expect(await dataCacheRepo.filesByTag('v3')).toHaveLength(0);
    expect(await dataCacheRepo.filesByTag('v2')).toHaveLength(1);
  });

  it('totalBytes sums every cached row, including duplicate sizes', async () => {
    expect(await dataCacheRepo.totalBytes()).toBe(0);
    await dataCacheRepo.putFile(fileRow('v1', 'a.json', 'essentials', 100));
    await dataCacheRepo.putFile(fileRow('v1', 'b.json', 'essentials', 250));
    // Same size as another row: index keys are not unique, so both must count.
    await dataCacheRepo.putFile(fileRow('v2', 'c.json', 'essentials', 100));
    expect(await dataCacheRepo.totalBytes()).toBe(450);
  });

  it('totalBytes drops as stale tags are swept', async () => {
    await dataCacheRepo.putFile(fileRow('v1', 'a.json', 'essentials', 300));
    await dataCacheRepo.putFile(fileRow('v2', 'a.json', 'essentials', 200));
    await dataCacheRepo.deleteOtherTags('v2');
    expect(await dataCacheRepo.totalBytes()).toBe(200);
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
