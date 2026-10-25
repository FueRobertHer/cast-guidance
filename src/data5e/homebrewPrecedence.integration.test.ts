// Which of two homebrew files defining the same name|source wins (IMP-002).
// The registry keeps the first entity it sees per uid and merges homebrew in
// `homebrewRepo.enabledSafe()` order, so that order is the policy: the
// earlier import wins. It used to be primary-key order, a content hash, so
// the winner depended on which file happened to hash lower.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { buildHomebrewRow } from '@/db/homebrewRepo';
import { DATA_TAG } from './config';
import { getRegistry, invalidateRegistry } from './registry';

function fireBolt(level: number) {
  return {
    _meta: { sources: [{ json: 'HB', abbreviation: 'HB', full: 'Homebrew' }] },
    spell: [{ name: 'Fire Bolt', source: 'HB', level }],
  };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.settings.put({ key: 'dataTag', value: DATA_TAG });
  invalidateRegistry();
});

describe('homebrew precedence', () => {
  // Both orders, so one of them always runs against the id order.
  it.each([
    ['level 1 first', 1, 2],
    ['level 2 first', 2, 1],
  ])('the earlier import wins a name|source tie (%s)', async (_, firstLevel, secondLevel) => {
    const first = await buildHomebrewRow(fireBolt(firstLevel), 'first.json');
    const second = await buildHomebrewRow(fireBolt(secondLevel), 'second.json');
    await db.homebrewFiles.bulkPut([
      { ...first, addedAt: 1_000 },
      { ...second, addedAt: 2_000 },
    ]);

    const reg = await getRegistry();
    expect(reg.get('spell', 'Fire Bolt', 'HB')?.level).toBe(firstLevel);
    // Lists still hold both.
    expect(reg.byType('spell').filter((s) => s.name === 'Fire Bolt')).toHaveLength(2);
  });
});
