// Changes to the books end to end (ADR-002, D2): a change saved into the
// player's Changes to the books through the store reaches, through the
// registry, every character holding the book's entry, with no reference
// rewritten; an imported file declaring the book still cannot replace it; and
// a pack's patch applies on top of it.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { dataCacheRepo } from '@/db/dataCacheRepo';
import { db } from '@/db/db';
import { buildHomebrewRow, homebrewRepo } from '@/db/homebrewRepo';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { findSpell } from '@/features/sheet/spellData';
import { writeChange } from '@/features/workshop/copyWriter';
import { DATA_TAG } from './config';
import type { Entity } from './copyMod';
import { engineContextFor } from './engineAdapter';
import { getActiveTag } from './loader';
import { type EntityRegistry, normalizeDataset } from './normalize';
import { getRegistry, invalidateRegistry } from './registry';

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

const BOOK: EntityRegistry = normalizeDataset(new Map(Object.entries(RELEASE)));
const book = (type: 'spell' | 'classFeature', name: string): Entity =>
  structuredClone(BOOK.get(type, name, 'XPHB') as Entity);

function barbarian(id: string): CharacterDoc {
  const doc = newCharacterDoc(id, id, DATA_TAG);
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 };
  doc.classes = [{ ref: { name: 'Barbarian', source: 'XPHB' }, levels: 1, hp: ['avg'] }];
  return doc;
}

const sheetOf = async (doc: CharacterDoc) =>
  deriveSheet(doc, engineContextFor(await getRegistry()));

/** Save a change as Change for your table will: into Changes to the books. */
const saveChange = (type: string, entry: Entity) =>
  homebrewRepo.saveEntry(type, entry as Entity & { name: string; source: string }, {
    role: 'changes',
  });

/** An imported file, as an import lands it: never with a role. */
async function importFile(json: Record<string, unknown>, fileName = 'phb.json'): Promise<void> {
  const row = await buildHomebrewRow(json, fileName);
  await homebrewRepo.commit(row);
}

const rageWith = (effects: unknown[], text?: string) => {
  const rage = book('classFeature', 'Rage');
  return writeChange('classFeature', rage, {
    ...rage,
    ...(text === undefined ? {} : { entries: [text] }),
    castGuidance: { v: 1, effects },
  });
};

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.settings.put({ key: 'dataTag', value: DATA_TAG });
  await seedRelease();
});

describe('a stored change to the books', () => {
  it('to Aid reaches every character holding the book’s', async () => {
    const aid = book('spell', 'Aid');
    await saveChange(
      'spell',
      writeChange('spell', aid, {
        ...aid,
        entries: [(aid.entries as string[])[0], AID_TEXT.replace('5', '10')],
      }),
    );
    const reg = await getRegistry();
    // Osk and Maren hold the book's Aid by its own name and source, as saved before the change.
    for (const who of ['osk', 'maren']) {
      const doc = barbarian(who);
      doc.addedSpells = [{ spell: { name: 'Aid', source: 'XPHB' }, ability: 'wis', uses: 'long' }];
      const held = doc.addedSpells[0]?.spell as { name: string; source: string };
      const shown = findSpell(reg, held.name, held.source, '2024');
      expect((shown?.entries as string[])[1]).toContain('increase by 10');
      expect(shown?.level).toBe(2);
      const sheet = deriveSheet(doc, engineContextFor(reg));
      expect(sheet.grantedSpells.some((g) => g.name === 'Aid' && g.source === 'XPHB')).toBe(true);
    }
    expect(reg.byType('spell').filter((s) => s.name === 'Aid')).toHaveLength(1);
  });

  it('to Rage reaches every barbarian holding the book’s, by its class and level', async () => {
    const before = await sheetOf(barbarian('osk'));
    await saveChange('classFeature', rageWith([{ kind: 'speedBonus', amount: 10 }]));
    for (const who of ['osk', 'maren']) {
      const after = await sheetOf(barbarian(who));
      expect(after.speedWalk.value).toBe(before.speedWalk.value + 10);
      // What it inherits is the book's still: its uses and its bonus action.
      expect(after.resources.find((r) => r.label === 'Rage')?.max).toBe(2);
    }
  });

  it('that changes nothing leaves the barbarian’s sheet as the book’s', async () => {
    const before = await sheetOf(barbarian('osk'));
    const rage = book('classFeature', 'Rage');
    await saveChange('classFeature', writeChange('classFeature', rage, rage));
    const reg = await getRegistry();
    expect(reg.changedEntries()).toHaveLength(1);
    expect(await sheetOf(barbarian('osk'))).toEqual(before);
  });

  it('cannot be replaced by an imported file declaring the book', async () => {
    await saveChange('classFeature', rageWith([{ kind: 'speedBonus', amount: 10 }]));
    const speed = (await sheetOf(barbarian('osk'))).speedWalk.value;
    await importFile({
      _meta: { sources: [{ json: 'XPHB', full: 'Player’s Handbook' }] },
      classFeature: [
        {
          ...book('classFeature', 'Rage'),
          entries: ['Rewritten.'],
          castGuidance: { v: 1, replace: true, effects: [{ kind: 'speedBonus', amount: 50 }] },
        },
      ],
    });
    invalidateRegistry();
    const reg = await getRegistry();
    const rage = reg.byType('classFeature').find((f) => f.name === 'Rage');
    expect(rage?.entries).toEqual(book('classFeature', 'Rage').entries);
    expect((await sheetOf(barbarian('osk'))).speedWalk.value).toBe(speed);
  });

  it('cannot be claimed by an imported row carrying the role', async () => {
    const row = await buildHomebrewRow(
      {
        _meta: { sources: [{ json: 'XPHB' }] },
        classFeature: [rageWith([{ kind: 'speedBonus', amount: 50 }])],
      },
      'forged.json',
    );
    // Written past the import, as a forged or older row could be.
    await db.homebrewFiles.put({ ...row, role: 'changes' } as typeof row);
    invalidateRegistry();
    const reg = await getRegistry();
    expect(reg.changedEntries()).toEqual([]);
    expect(reg.byType('classFeature').find((f) => f.name === 'Rage')?.entries).toEqual(
      book('classFeature', 'Rage').entries,
    );
  });

  it('takes a pack’s patch on top, as the book’s entry does', async () => {
    await saveChange('classFeature', rageWith([{ kind: 'speedBonus', amount: 10 }]));
    await importFile(
      {
        _meta: {
          sources: [{ json: 'TBL', full: 'Our Table' }],
          castGuidance: {
            v: 1,
            patches: [{ target: 'Rage|Barbarian', add: [{ kind: 'initiativeBonus', amount: 3 }] }],
          },
        },
      },
      'table.json',
    );
    const pack = (await homebrewRepo.listMetaSafe()).files.find((f) => f.sourceIds[0] === 'TBL');
    await homebrewRepo.setPackLocal(pack?.id as string, () => ({
      appliesTo: { characters: ['osk'] },
    }));
    invalidateRegistry();
    const base = barbarian('maren');
    const osk = await sheetOf(barbarian('osk'));
    const maren = await sheetOf(base);
    expect(osk.initiative.value).toBe(maren.initiative.value + 3);
    expect(osk.speedWalk.value).toBe(maren.speedWalk.value);
  });
});
