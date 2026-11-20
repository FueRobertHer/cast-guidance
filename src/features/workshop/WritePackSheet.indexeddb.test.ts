// Write a rule pack end to end (ADR-002 U9, board 10, B): the player's table
// rule and their Changes to the books (Aid and Rage) are written into a pack,
// saved, exported as the Export button sends it, and imported on a fresh
// device through the import's own path. It lands unchanged (same id, same
// JSON), and applied to Hild alone it gives Hild the rule and both changes,
// while Maren keeps the book's.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_TAG } from '@/data5e/config';
import type { Entity } from '@/data5e/copyMod';
import { engineContextFor } from '@/data5e/engineAdapter';
import { getActiveTag } from '@/data5e/loader';
import { normalizeDataset } from '@/data5e/normalize';
import { getRegistry, invalidateRegistry } from '@/data5e/registry';
import { registryViewFor } from '@/data5e/registryView';
import { packRefusals, sharedFile } from '@/data5e/rulePack';
import { dataCacheRepo } from '@/db/dataCacheRepo';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { deriveSheet } from '@/engine/derive';
import { rulesFor } from '@/engine/rules';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import {
  commitHomebrewImport,
  prepareHomebrewImport,
} from '@/features/homebrew/HomebrewImportPreview';
import { packReplaces, packReview } from '@/features/homebrew/importPreview';
import { savePackLocal } from '@/features/homebrew/PackReviewSheet';
import { findSpell } from '@/features/sheet/spellData';
import { writeChange } from './copyWriter';
import {
  changesIn,
  exportPack,
  packFileName,
  packSource,
  replacedRef,
  savePack,
  writtenPack,
} from './WritePackSheet';

// What Export hands the browser, as `downloadJson` writes it.
const downloads = vi.hoisted(() => [] as Array<{ name: string; text: string }>);
vi.mock('@/lib/download', async (actual) => ({
  ...(await actual<typeof import('@/lib/download')>()),
  downloadJson: (name: string, data: unknown) =>
    downloads.push({ name, text: JSON.stringify(data, null, 2) }),
}));

const AID_TEXT = 'Each target’s Hit Point maximum and current Hit Points increase by 5.';

const RELEASE: Record<string, unknown> = {
  'spells/spells-xphb.json': {
    spell: [
      {
        name: 'Aid',
        source: 'XPHB',
        level: 2,
        school: 'A',
        range: { type: 'point', distance: { type: 'feet', amount: 30 } },
        entries: ['Choose up to three creatures within range.', AID_TEXT],
      },
    ],
  },
  'class/class-barbarian.json': {
    class: [
      {
        name: 'Barbarian',
        source: 'XPHB',
        edition: 'one',
        hd: { number: 1, faces: 12 },
        proficiency: ['str', 'con'],
        classFeatures: ['Rage|Barbarian|XPHB|1'],
      },
    ],
    classFeature: [
      {
        name: 'Rage',
        source: 'XPHB',
        className: 'Barbarian',
        classSource: 'XPHB',
        level: 1,
        entries: ['You can imbue yourself with a primal power called Rage.'],
      },
    ],
  },
};

const BOOK = normalizeDataset(new Map(Object.entries(RELEASE)));
const book = (type: 'spell' | 'classFeature', name: string): Entity =>
  structuredClone(BOOK.get(type, name, 'XPHB') as Entity);

async function seedRelease(): Promise<void> {
  for (const [path, json] of Object.entries(RELEASE)) {
    await dataCacheRepo.putFile({
      key: dataCacheRepo.key(getActiveTag(), path),
      tag: getActiveTag(),
      path,
      pack: 'essentials',
      json,
      bytes: 0,
      fetchedAt: 1,
    });
  }
  invalidateRegistry();
}

function barbarian(id: string): CharacterDoc {
  const doc = newCharacterDoc(id, id, DATA_TAG);
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 };
  doc.classes = [{ ref: { name: 'Barbarian', source: 'XPHB' }, levels: 1, hp: ['avg'] }];
  return doc;
}

/** Aid at 10 and Rage adding 10 feet of speed, saved as Change for your table saves them. */
async function saveChanges(): Promise<void> {
  const aid = book('spell', 'Aid');
  await homebrewRepo.saveEntry(
    'spell',
    writeChange('spell', aid, {
      ...aid,
      entries: [(aid.entries as string[])[0], AID_TEXT.replace('5', '10')],
    }) as Entity & { name: string; source: string },
    { role: 'changes' },
  );
  const rage = book('classFeature', 'Rage');
  await homebrewRepo.saveEntry(
    'classFeature',
    writeChange('classFeature', rage, {
      ...rage,
      castGuidance: { v: 1, effects: [{ kind: 'speedBonus', amount: 10 }] },
    }) as Entity & { name: string; source: string },
    { role: 'changes' },
  );
  invalidateRegistry();
}

async function changesFile() {
  return (await homebrewRepo.ownedSafe()).files.find((f) => f.role === 'changes');
}

/** A fresh device with the same game data: no homebrew, no characters. */
async function freshDevice(): Promise<void> {
  await db.homebrewFiles.clear();
  await db.homebrewJson.clear();
  invalidateRegistry();
}

beforeEach(async () => {
  downloads.length = 0;
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.settings.put({ key: 'dataTag', value: DATA_TAG });
  await seedRelease();
});

describe('a written rule pack', () => {
  it('survives export and import unchanged, and reaches only the characters it applies to', async () => {
    const before = deriveSheet(barbarian('maren'), engineContextFor(await getRegistry()));
    await saveChanges();
    const changes = changesIn((await changesFile())?.json);
    expect(changes.map((c) => `${c.type}:${String(c.entry.name)}`)).toEqual([
      'spell:Aid',
      'classFeature:Rage',
    ]);

    const json = writtenPack({
      name: 'Lantern Coast rules',
      source: packSource('Lantern Coast rules', []),
      stamp: 'stamp-1',
      rules: { restLength: 'gritty' },
      changes,
    });
    // It names each change by the identity the merge reads, and holds each one.
    expect(packReplaces(json)?.entries.map((r) => [r.words, r.inPack])).toEqual([
      ['Aid (spell, XPHB)', true],
      ['Rage (class feature, XPHB, Barbarian, level 1)', true],
    ]);
    expect(
      packRefusals((json._meta as { castGuidance: Record<string, unknown> }).castGuidance),
    ).toEqual([]);
    const fileName = packFileName('Lantern Coast rules');
    expect(fileName).toBe('lantern-coast-rules.json');
    const { row } = await savePack(json, fileName);
    // Its own source alone: a book code here would take that book off The books.
    expect(row.sourceIds).toEqual(['LanternCoastRules']);
    expect(row.key).toBe('made:stamp-1');
    expect(row.enabled).toBe(true);
    expect(row.pack).toBeUndefined();

    exportPack(row);
    const [file] = downloads;
    expect(file?.name).toBe('lantern-coast-rules.json');
    const exported = JSON.parse(file?.text ?? 'null') as Record<string, unknown>;
    expect(exported).toEqual(sharedFile(row.json));

    // On this device the same file is already here.
    const again = await commitHomebrewImport(
      await prepareHomebrewImport(exported, fileName, undefined),
    );
    expect(again.message).toMatch(/already/i);
    expect(await db.homebrewFiles.count()).toBe(2);

    await freshDevice();
    const landed = await commitHomebrewImport(
      await prepareHomebrewImport(exported, fileName, undefined),
    );
    expect(landed.ok).toBe(true);
    const stored = await homebrewRepo.getSafe(row.id);
    expect(stored.file?.json).toEqual(row.json);
    expect(stored.file?.json).toEqual(json);
    expect(stored.file?.key).toBe('made:stamp-1');
    expect(packReview(stored.file?.json)).toEqual(packReview(json));

    // Applied to Hild alone.
    await savePackLocal(row.id, (local) => ({ ...local, appliesTo: { characters: ['hild'] } }));
    const reg = await getRegistry();
    const hild = barbarian('hild');
    const maren = barbarian('maren');
    expect(rulesFor(hild, engineContextFor(reg, {}, hild)).restLength).toBe('gritty');
    expect(rulesFor(maren, engineContextFor(reg, {}, maren)).restLength).toBe('standard');
    const aidFor = (doc: CharacterDoc) =>
      (findSpell(registryViewFor(reg, doc), 'Aid', 'XPHB', '2024')?.entries as string[])[1];
    expect(aidFor(hild)).toContain('increase by 10');
    expect(aidFor(maren)).toBe(AID_TEXT);
    const speed = (doc: CharacterDoc) =>
      deriveSheet(doc, engineContextFor(reg, {}, doc)).speedWalk.value;
    expect(speed(hild)).toBe(before.speedWalk.value + 10);
    expect(speed(maren)).toBe(before.speedWalk.value);
  });

  it('holds only the rules and changes picked, and nothing else', () => {
    const json = writtenPack({
      name: 'Just crits',
      source: 'JustCrits',
      stamp: 's',
      rules: { critDamage: 'doubleTotal' },
      changes: [],
    });
    expect(json).toEqual({
      _meta: {
        sources: [
          {
            json: 'JustCrits',
            abbreviation: 'JustCrits',
            full: 'Just crits',
            authors: [],
            version: '1.0.0',
          },
        ],
        castGuidanceCollection: 's',
        castGuidance: { v: 1, tableRules: { critDamage: 'doubleTotal' } },
      },
    });
  });

  it('names a change written as changes by the identity it keeps in its copy', () => {
    const rage = {
      _copy: {
        name: 'Rage',
        source: 'XPHB',
        className: 'Barbarian',
        classSource: 'XPHB',
        level: 1,
      },
    };
    expect(replacedRef('classFeature', rage as Record<string, unknown>)).toEqual({
      type: 'classFeature',
      name: 'Rage',
      source: 'XPHB',
      className: 'Barbarian',
      classSource: 'XPHB',
      level: 1,
    });
  });

  it('gets a source of its own, never one a stored file declares', () => {
    expect(packSource('Lantern Coast rules', ['lanterncoastrules', 'LanternCoastRules2'])).toBe(
      'LanternCoastRules3',
    );
    // A short name or a book's code reads as homebrew, as a new collection's does.
    expect(packSource('PHB', [])).toBe('PHBHomebrew');
  });
});
