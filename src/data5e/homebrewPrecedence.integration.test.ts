// Which of two homebrew files defining the same name|source wins (IMP-002).
// The registry keeps the first entity it sees per uid and merges homebrew in
// `homebrewRepo.enabledSafe()` order, so that order is the policy: the
// earlier import wins. It used to be primary-key order, a content hash, so
// the winner depended on which file happened to hash lower. Import order
// must decide only that: whether a `_copy` across files resolves must not
// depend on which file was imported first.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { buildHomebrewRow } from '@/db/homebrewRepo';
import { newCharacterDoc } from '@/engine/types';
import { CHARACTER_EXPORT_FORMAT } from '@/lib/guards';
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

/** A homebrew file declaring `source`, holding `spells`. */
function brew(source: string, spells: Record<string, unknown>[], dependsOn: string[] = []) {
  return {
    _meta: {
      sources: [{ json: source, abbreviation: source, full: source }],
      ...(dependsOn.length > 0 ? { dependencies: { spell: dependsOn } } : {}),
    },
    spell: spells,
  };
}

const copyOf = (name: string, source: string, from: string, fromSource: string) => ({
  name,
  source,
  _copy: { name: from, source: fromSource },
});

// A file that copies from another (A's Child copies B's Base).
const dependent = () => brew('AAA', [copyOf('Child', 'AAA', 'Base', 'BBB')], ['BBB']);
const provider = () => brew('BBB', [{ name: 'Base', source: 'BBB', level: 3 }]);

async function store(files: [unknown, number][]): Promise<void> {
  for (const [json, addedAt] of files) {
    const row = await buildHomebrewRow(json, 'file.json');
    await db.homebrewFiles.put({ ...row, addedAt });
  }
}

describe('a _copy across homebrew files', () => {
  // Import order is precedence, so it must not also decide whether a copy
  // resolves: the file a copy needs may well be imported after it.
  it.each([
    ['the provider imported first', provider, dependent],
    ['the dependent imported first', dependent, provider],
  ])('resolves with %s', async (_, first, second) => {
    await store([
      [first(), 1_000],
      [second(), 2_000],
    ]);
    const reg = await getRegistry();
    expect(reg.get('spell', 'Child', 'AAA')?.level).toBe(3);
  });

  it('resolves between files that each copy from the other', async () => {
    await store([
      [
        brew('AAA', [
          copyOf('Child', 'AAA', 'Base', 'BBB'),
          { name: 'Root', source: 'AAA', level: 5 },
        ]),
        1_000,
      ],
      [
        brew('BBB', [
          { name: 'Base', source: 'BBB', level: 3 },
          copyOf('Leaf', 'BBB', 'Root', 'AAA'),
        ]),
        2_000,
      ],
    ]);
    const reg = await getRegistry();
    expect(reg.get('spell', 'Child', 'AAA')?.level).toBe(3);
    expect(reg.get('spell', 'Leaf', 'BBB')?.level).toBe(5);
  });

  it('leaves a copy cycle unresolved without losing the registry', async () => {
    await store([
      [brew('AAA', [copyOf('X', 'AAA', 'Y', 'BBB')]), 1_000],
      [brew('BBB', [copyOf('Y', 'BBB', 'X', 'AAA')]), 2_000],
    ]);
    const reg = await getRegistry();
    expect(reg.get('spell', 'X', 'AAA')).toBeDefined();
    expect(reg.get('spell', 'Y', 'BBB')).toBeDefined();
    expect(reg.warnings.filter((w) => w.message.includes('unresolved _copy'))).toHaveLength(2);
  });

  it.each([
    ['dependent listed first', [dependent, provider]],
    ['provider listed first', [provider, dependent]],
  ])('resolves between files of one character export (%s)', async (_, files) => {
    // One import stamps every embedded file with the same time, so their
    // order comes down to the content hash.
    const text = JSON.stringify({
      $format: CHARACTER_EXPORT_FORMAT,
      character: newCharacterDoc('hero', 'Hero', DATA_TAG),
      homebrew: files.map((f, i) => ({ fileName: `${i}.json`, json: f() })),
    });
    await characterRepo.importFromText(text);
    const rows = await db.homebrewFiles.toArray();
    expect(new Set(rows.map((r) => r.addedAt)).size).toBe(1);
    const reg = await getRegistry();
    expect(reg.get('spell', 'Child', 'AAA')?.level).toBe(3);
  });
});
