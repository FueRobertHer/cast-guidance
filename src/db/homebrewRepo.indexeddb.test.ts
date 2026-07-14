// IndexedDB-backed coverage for the homebrew repository (TEST-002 harness).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ValidationError } from '@/lib/guards';
import { db } from './db';
import { buildHomebrewRow, homebrewRepo } from './homebrewRepo';

function file(sourceId: string, spells: string[] = []) {
  return {
    _meta: { sources: [{ json: sourceId, abbreviation: sourceId, full: sourceId }] },
    spell: spells.map((name) => ({ name, source: sourceId, level: 1 })),
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('homebrewRepo.importJson (IndexedDB-backed)', () => {
  it('stores a file under a content-hash id with recomputed metadata', async () => {
    const row = await homebrewRepo.importJson(file('BREW', ['Zap']), 'brew.json');
    expect(row.id).toMatch(/^[0-9a-f]{64}$/);
    expect(row.editable).toBe(false);
    expect(row.sourceIds).toEqual(['BREW']);
    expect(row.counts).toEqual({ spell: 1 });
    expect(await db.homebrewFiles.count()).toBe(1);
  });

  it('is idempotent — re-importing identical content returns the existing row', async () => {
    const a = await homebrewRepo.importJson(file('BREW', ['Zap']), 'brew.json');
    const b = await homebrewRepo.importJson(file('BREW', ['Zap']), 'renamed.json');
    expect(b.id).toBe(a.id);
    expect(await db.homebrewFiles.count()).toBe(1); // no duplicate
  });

  it('rejects an adversarially deep payload before storing', async () => {
    let deep: unknown = 0;
    for (let i = 0; i < 80; i++) deep = [deep];
    const payload = { ...file('BREW'), nested: deep };
    await expect(homebrewRepo.importJson(payload, 'evil.json')).rejects.toThrow(ValidationError);
    expect(await db.homebrewFiles.count()).toBe(0);
  });
});

describe('homebrewRepo editable files (IndexedDB-backed)', () => {
  it('bumps rev on each save so the registry/search signature changes', async () => {
    const created = await homebrewRepo.createEditable('My Brew', 'MB');
    expect(created.editable).toBe(true);

    await homebrewRepo.saveEditable(created.id, file('MB', ['One']));
    await homebrewRepo.saveEditable(created.id, file('MB', ['Two', 'Three']));

    const saved = await homebrewRepo.get(created.id);
    expect(saved?.rev).toBe(2);
    expect(saved?.counts).toEqual({ spell: 2 });
    expect(saved?.id).toBe(created.id); // identity stable across edits
  });

  it('enabled() returns only enabled files', async () => {
    const a = await homebrewRepo.importJson(file('A', ['x']), 'a.json');
    const b = await homebrewRepo.importJson(file('B', ['y']), 'b.json');
    await homebrewRepo.setEnabled(b.id, false);
    const enabled = await homebrewRepo.enabled();
    expect(enabled.map((r) => r.id)).toEqual([a.id]);
  });
});

describe('buildHomebrewRow', () => {
  it('produces a stable content hash independent of the file name', async () => {
    const r1 = await buildHomebrewRow(file('BREW', ['Zap']), 'one.json');
    const r2 = await buildHomebrewRow(file('BREW', ['Zap']), 'two.json');
    expect(r1.id).toBe(r2.id);
  });
});
