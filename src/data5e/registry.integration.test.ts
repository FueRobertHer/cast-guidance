// IndexedDB-backed integration test (TEST-002/003) for the registry rebuild
// that powers SEARCH-001: an editable-homebrew edit must change the registry
// signature (the search-index cache key) so results can't go stale.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
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
