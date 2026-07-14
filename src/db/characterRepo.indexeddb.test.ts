// Real IndexedDB-backed coverage (TEST-002) for the transactional repo paths
// that were previously only verifiable in the browser. `fake-indexeddb/auto`
// installs an in-memory IndexedDB before Dexie is imported.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import { CHARACTER_EXPORT_FORMAT } from '@/lib/guards';
import { characterRepo } from './characterRepo';
import { db, type HomebrewFileRow } from './db';

function brewFile(sourceId: string, spellName: string) {
  return {
    _meta: { sources: [{ json: sourceId, abbreviation: sourceId, full: sourceId }] },
    spell: [{ name: spellName, source: sourceId, level: 1 }],
  };
}

function exportText(character: unknown, homebrew: unknown[] = []): string {
  return JSON.stringify({ $format: CHARACTER_EXPORT_FORMAT, character, homebrew });
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('characterRepo.importExport (IndexedDB-backed)', () => {
  it('commits the character and embedded homebrew, content-hashing identity', async () => {
    const doc = newCharacterDoc('hero-1', 'Imported', 'tag');
    const summary = await characterRepo.importFromText(
      exportText(doc, [{ fileName: 'b.json', json: brewFile('BREW', 'Zap') }]),
    );

    expect(summary).toMatchObject({ homebrewAdded: 1, homebrewSkipped: 0, renamed: false });
    expect(await db.characters.count()).toBe(1);
    const brews = await db.homebrewFiles.toArray();
    expect(brews).toHaveLength(1);
    expect(brews[0]?.id).toMatch(/^[0-9a-f]{64}$/); // content hash, not caller-supplied
    expect(brews[0]?.editable).toBe(false);
    expect(brews[0]?.sourceIds).toEqual(['BREW']);
  });

  it('recomputes homebrew id so a forged id cannot overwrite a local file', async () => {
    const victim: HomebrewFileRow = {
      id: 'LOCAL-VICTIM',
      fileName: 'victim.json',
      json: brewFile('VICTIM', 'Real Spell'),
      enabled: true,
      editable: true,
      sourceIds: ['VICTIM'],
      counts: { spell: 1 },
      addedAt: 1,
    };
    await db.homebrewFiles.put(victim);

    await characterRepo.importFromText(
      exportText(newCharacterDoc('h', 'H', 'tag'), [
        // Forges the victim's id, claims editable, with different content.
        {
          id: 'LOCAL-VICTIM',
          editable: true,
          fileName: 'evil.json',
          json: brewFile('ATTACKER', 'Evil'),
        },
      ]),
    );

    const stillVictim = await db.homebrewFiles.get('LOCAL-VICTIM');
    expect(stillVictim?.editable).toBe(true);
    expect(JSON.stringify(stillVictim?.json)).toContain('Real Spell');
    // The imported file landed under its own content hash, editable forced off.
    const imported = (await db.homebrewFiles.toArray()).find((r) => r.id !== 'LOCAL-VICTIM');
    expect(imported?.editable).toBe(false);
    expect(imported?.sourceIds).toEqual(['ATTACKER']);
  });

  it('renames on id collision and skips duplicate homebrew on re-import', async () => {
    const text = exportText(newCharacterDoc('dup-id', 'Dup', 'tag'), [
      { fileName: 'b.json', json: brewFile('BREW', 'Zap') },
    ]);
    const first = await characterRepo.importFromText(text);
    const second = await characterRepo.importFromText(text);

    expect(first.renamed).toBe(false);
    expect(second.renamed).toBe(true);
    expect(second.id).not.toBe('dup-id');
    expect(second.homebrewAdded).toBe(0);
    expect(second.homebrewSkipped).toBe(1);
    expect(await db.characters.count()).toBe(2);
    expect(await db.homebrewFiles.count()).toBe(1); // no duplicate homebrew
  });

  it('rolls the whole import back when the character write fails', async () => {
    const putSpy = vi
      .spyOn(db.characters, 'put')
      .mockRejectedValueOnce(new Error('simulated write failure'));

    await expect(
      characterRepo.importFromText(
        exportText(newCharacterDoc('h', 'H', 'tag'), [
          { fileName: 'b.json', json: brewFile('BREW', 'Zap') },
        ]),
      ),
    ).rejects.toThrow('simulated write failure');

    // The embedded homebrew add in the same transaction must not persist.
    expect(await db.homebrewFiles.count()).toBe(0);
    expect(await db.characters.count()).toBe(0);
    putSpy.mockRestore();
  });

  it('leaves the database untouched on malformed / future-version imports', async () => {
    await db.characters.put(newCharacterDoc('existing', 'Keep', 'tag'));

    await expect(characterRepo.importFromText('{ not json')).rejects.toThrow();
    await expect(
      characterRepo.importFromText(exportText({ id: 'x', schemaVersion: 9999, name: 'Future' })),
    ).rejects.toThrow();

    expect(await db.characters.count()).toBe(1); // only the pre-existing one
    expect((await db.characters.toArray())[0]?.id).toBe('existing');
  });
});

describe('characterRepo.delete (IndexedDB-backed)', () => {
  it('removes the character and its history together', async () => {
    await characterRepo.put(newCharacterDoc('c1', 'A', 'tag'));
    await db.characterHistory.add({
      id: 'h1',
      charId: 'c1',
      at: 1,
      label: 'snapshot',
      doc: newCharacterDoc('c1', 'A', 'tag'),
    });

    await characterRepo.delete('c1');

    expect(await db.characters.count()).toBe(0);
    expect(await db.characterHistory.count()).toBe(0);
  });
});
