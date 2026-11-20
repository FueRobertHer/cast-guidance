// The file of the player's changes to the books finds an entry by the change's
// identity (ADR-002, D2): two features of one name and book, as each class's
// Ability Score Improvement, are two changes. Every other file keeps name and
// book. Real repository over fake-indexeddb.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { EntryClash, homebrewRepo } from './homebrewRepo';

/** A class feature, as a change to the books writes it: its class and level on it. */
const grit = (level: number, entries = [`Grit at level ${level}.`]) => ({
  name: 'Grit',
  source: 'HB',
  className: 'Sorcerer',
  classSource: 'TST',
  level,
  entries,
});

const stored = async (fileId: string) =>
  (await homebrewRepo.getSafe(fileId)).file?.json.classFeature as Array<Record<string, unknown>>;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('the changes file', () => {
  it('holds two changes to features of one name and book at two levels', async () => {
    const { fileId } = await homebrewRepo.saveEntry('classFeature', grit(4), { role: 'changes' });
    await homebrewRepo.saveEntry('classFeature', grit(8), { role: 'changes' });
    expect((await stored(fileId)).map((e) => e.level)).toEqual([4, 8]);
  });

  it('is found by identity when named by its id too', async () => {
    const { fileId } = await homebrewRepo.saveEntry('classFeature', grit(4), { role: 'changes' });
    await homebrewRepo.saveEntry('classFeature', grit(8), { fileId });
    expect((await stored(fileId)).map((e) => e.level)).toEqual([4, 8]);
  });

  it('replaces the change `replaces` names by its identity, and no other', async () => {
    const { fileId } = await homebrewRepo.saveEntry('classFeature', grit(4), { role: 'changes' });
    await homebrewRepo.saveEntry('classFeature', grit(8), { role: 'changes' });
    await homebrewRepo.saveEntry('classFeature', grit(8, ['Changed again.']), {
      role: 'changes',
      replaces: grit(8),
    });
    expect((await stored(fileId)).map((e) => e.entries)).toEqual([
      ['Grit at level 4.'],
      ['Changed again.'],
    ]);
  });

  it('refuses a second change of one identity', async () => {
    await homebrewRepo.saveEntry('classFeature', grit(8), { role: 'changes' });
    await expect(
      homebrewRepo.saveEntry('classFeature', grit(8, ['Twice.']), { role: 'changes' }),
    ).rejects.toBeInstanceOf(EntryClash);
  });

  it('reads an identity its change leaves to its `_copy`', async () => {
    const { name, source, ...parent } = grit(8);
    const { fileId } = await homebrewRepo.saveEntry(
      'classFeature',
      { name, source, _copy: { name, source, ...parent }, entries: ['Short.'] },
      { role: 'changes' },
    );
    await homebrewRepo.saveEntry('classFeature', grit(4), { role: 'changes' });
    expect(await homebrewRepo.removeEntry(fileId, 'classFeature', grit(8))).toBe(true);
    expect((await stored(fileId)).map((e) => e.level)).toEqual([4]);
  });

  it('removes the change a key names by its identity, and no other', async () => {
    const { fileId } = await homebrewRepo.saveEntry('classFeature', grit(4), { role: 'changes' });
    await homebrewRepo.saveEntry('classFeature', grit(8), { role: 'changes' });
    // Name and book alone name neither: a feature's identity has its class and level.
    expect(
      await homebrewRepo.removeEntry(fileId, 'classFeature', { name: 'Grit', source: 'HB' }),
    ).toBe(false);
    expect(await homebrewRepo.removeEntry(fileId, 'classFeature', grit(8))).toBe(true);
    expect((await stored(fileId)).map((e) => e.level)).toEqual([4]);
  });

  it('matches a spell, which has no parent, by name and book as before', async () => {
    const { fileId } = await homebrewRepo.saveEntry(
      'spell',
      { name: 'Aid', source: 'PHB', level: 2 },
      { role: 'changes' },
    );
    await expect(
      homebrewRepo.saveEntry(
        'spell',
        { name: 'aid', source: 'phb', level: 3 },
        { role: 'changes' },
      ),
    ).rejects.toBeInstanceOf(EntryClash);
    expect(await homebrewRepo.removeEntry(fileId, 'spell', { name: 'AID', source: 'Phb' })).toBe(
      true,
    );
  });
});

describe('every other file', () => {
  it('keeps name and book: a second feature of one name and book is refused', async () => {
    await homebrewRepo.saveEntry('classFeature', grit(4));
    await expect(homebrewRepo.saveEntry('classFeature', grit(8))).rejects.toBeInstanceOf(
      EntryClash,
    );
  });
});
