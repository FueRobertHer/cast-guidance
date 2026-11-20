// Changes per character end to end (ADR-002, D3, question 1): changes saved
// into Changes to the books through the store, read back through the real
// registry. Hild switches the collection off and derives with the book's
// entries; Maren keeps the changes. A collection switched off on the device
// reaches Osk alone, who turns it on for himself.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { dataCacheRepo } from '@/db/dataCacheRepo';
import { db } from '@/db/db';
import { CHANGES_SOURCE, homebrewRepo } from '@/db/homebrewRepo';
import { homebrewCatalog } from '@/engine/curated/effectCatalog';
import { missingCharacterData } from '@/engine/dataNeeds';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { findSpell } from '@/features/sheet/spellData';
import { writeChange } from '@/features/workshop/copyWriter';
import { DATA_TAG } from './config';
import type { Entity } from './copyMod';
import { engineContextFor } from './engineAdapter';
import { getActiveTag } from './loader';
import { normalizeDataset } from './normalize';
import { getRegistry, invalidateRegistry } from './registry';
import { registryViewFor } from './registryView';

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

function barbarian(id: string, edit: (doc: CharacterDoc) => void = () => undefined): CharacterDoc {
  const doc = newCharacterDoc(id, id, DATA_TAG);
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 };
  doc.classes = [{ ref: { name: 'Barbarian', source: 'XPHB' }, levels: 1, hp: ['avg'] }];
  doc.addedSpells = [{ spell: { name: 'Aid', source: 'XPHB' }, ability: 'wis', uses: 'long' }];
  edit(doc);
  return doc;
}

const hild = barbarian('hild', (d) => {
  d.sourceSwitches = { off: [CHANGES_SOURCE] };
});
const maren = barbarian('maren');

/** The changes Change for your table would save: Aid at +10, and Rage with 2 more HP a level. */
async function saveChanges(): Promise<void> {
  const aid = book('spell', 'Aid');
  const rage = book('classFeature', 'Rage');
  const save = (type: string, entry: Entity) =>
    homebrewRepo.saveEntry(type, entry as Entity & { name: string; source: string }, {
      role: 'changes',
    });
  await save(
    'spell',
    writeChange('spell', aid, {
      ...aid,
      entries: [(aid.entries as string[])[0], AID_TEXT.replace('5', '10')],
      castGuidance: { v: 1, effects: [{ kind: 'maxHpBonus', amount: 10 }] },
    }),
  );
  await save(
    'classFeature',
    writeChange('classFeature', rage, {
      ...rage,
      castGuidance: { v: 1, effects: [{ kind: 'hpPerLevel', amount: 2 }] },
    }),
  );
  invalidateRegistry();
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.settings.put({ key: 'dataTag', value: DATA_TAG });
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
});

describe('Changes to the books off for Hild', () => {
  it('gives her the book’s Aid and Rage, while Maren keeps the changes', async () => {
    const before = deriveSheet(hild, engineContextFor(await getRegistry(), undefined, hild));
    await saveChanges();
    const reg = await getRegistry();
    const hers = registryViewFor(reg, hild);
    // The info sheet's text.
    expect((findSpell(hers, 'Aid', 'XPHB', '2024')?.entries as string[])[1]).toBe(AID_TEXT);
    expect((findSpell(reg, 'Aid', 'XPHB', '2024')?.entries as string[])[1]).toContain('by 10');
    // + Effect lists the changed Aid for Maren alone; Hild has the curated one.
    expect(homebrewCatalog(hers).entries.map((e) => e.name)).not.toContain('Aid');
    expect(homebrewCatalog(registryViewFor(reg, maren)).entries.map((e) => e.name)).toContain(
      'Aid',
    );
    // The sheet and the list's HP: the derive reads her view.
    const hp = (doc: CharacterDoc) =>
      deriveSheet(doc, engineContextFor(reg, undefined, doc)).maxHp.value;
    expect(hp(hild)).toBe(before.maxHp.value);
    expect(hp(maren)).toBe(before.maxHp.value + 2);
  });
});

describe('a collection switched off on the device', () => {
  const kibbles = {
    _meta: { sources: [{ json: 'KIB', full: 'Kibbles’ Compendium' }] },
    class: [
      {
        name: 'Warden',
        source: 'KIB',
        hd: { number: 1, faces: 10 },
        proficiency: ['str', 'con'],
      },
    ],
  };
  const warden = (id: string, switches?: CharacterDoc['sourceSwitches']) => {
    const doc = newCharacterDoc(id, id, DATA_TAG);
    doc.abilities.method = 'manual';
    doc.abilities.base = { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
    doc.classes = [{ ref: { name: 'Warden', source: 'KIB' }, levels: 1, hp: ['avg'] }];
    if (switches !== undefined) doc.sourceSwitches = switches;
    return doc;
  };

  it('reaches Osk, who turns it on, and nobody else', async () => {
    const row = await homebrewRepo.importJson(kibbles, 'kibbles.json');
    await homebrewRepo.setEnabled(row.id, false);
    invalidateRegistry();
    const reg = await getRegistry();
    expect(reg.get('class', 'Warden', 'KIB')).toBeUndefined();
    const osk = warden('osk', { on: ['KIB'] });
    const ctx = engineContextFor(reg, undefined, osk);
    expect(missingCharacterData(osk, ctx).classes).toEqual([]);
    expect(deriveSheet(osk, ctx).maxHp.value).toBe(12);
    // Maren's sheet still finds no Warden.
    const maren = warden('maren');
    expect(
      missingCharacterData(maren, engineContextFor(reg, undefined, maren)).classes,
    ).not.toEqual([]);
  });

  it('keeps the registry current while it stays off, and rebuilds it on an edit', async () => {
    const file = await homebrewRepo.createEditable('Lantern Coast', 'LC');
    await homebrewRepo.setEnabled(file.id, false);
    invalidateRegistry();
    const first = await getRegistry();
    expect(await getRegistry()).toBe(first);
    const json = {
      ...(file.json as Record<string, unknown>),
      feat: [{ name: 'Lamplit', source: file.sourceIds[0] }],
    };
    await homebrewRepo.saveEditable(file.id, json);
    const next = await getRegistry();
    expect(next).not.toBe(first);
    const lc = { id: 'osk', sourceSwitches: { on: file.sourceIds } };
    expect(registryViewFor(next, lc).get('feat', 'Lamplit', file.sourceIds[0])).toBeDefined();
    expect(next.get('feat', 'Lamplit', file.sourceIds[0])).toBeUndefined();
  });
});
