// Rule packs end to end (Homebrew Workshop phase 10): a real pack file comes in
// through the import, is applied to characters, reaches the engine through the
// registry, and changes a real build's table rules, moments and effects. Who it
// applies to stays on this device.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { DATA_TAG } from '@/data5e/config';
import { getRegistry, invalidateRegistry } from '@/data5e/registry';
import { PACK_LOCAL_KEY } from '@/data5e/rulePack';
import { db } from '@/db/db';
import { buildHomebrewRow, homebrewRepo, putHomebrewRow } from '@/db/homebrewRepo';
import { type PackAppliesTo, RULE_PACK_TYPE } from '@/engine/castGuidance';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, type EngineContext, newCharacterDoc } from '@/engine/types';
import { homebrewForExport } from '@/features/characters/homebrewExport';
import grittyTable from '../../../tests-fixtures/packs/gritty-table.json';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { commitHomebrewImport } from './HomebrewImportPreview';
import { savePackLocal } from './PackReviewSheet';

/** A level 5 warrior with the Alert feat: derive.test's hand-checked build. */
function warrior(id: string): CharacterDoc {
  const doc = newCharacterDoc(id, 'Grog', 'test-tag');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 };
  doc.race = { name: 'Testfolk', source: 'TST' };
  doc.background = { name: 'Scholar', source: 'TST' };
  doc.classes = [
    {
      ref: { name: 'Warrior', source: 'TST' },
      subclass: { name: 'Path of Tests', source: 'TST' },
      levels: 5,
      hp: ['avg', 'avg', 'avg', 'avg', 'avg'],
    },
  ];
  doc.choices = {
    'background:scholar|tst:skill:0': ['Arcana', 'History'],
    'race:testfolk|tst:lang:0': ['Elvish'],
    'class:warrior|tst:skill:0': ['Athletics', 'Intimidation'],
    'class:warrior|tst:optfeature:FS:T': ['defense|phb'],
    'class:warrior|tst:asi:4': 'feat',
    'class:warrior|tst:asi:4:feat': 'alert|phb',
  };
  return doc;
}

/** The test world, with the registry's packs as the engine reads them. */
async function context(rules?: EngineContext['rules']): Promise<EngineContext> {
  const reg = await getRegistry();
  const world = makeTestContext();
  return {
    ...world,
    byType: (type) => (type === RULE_PACK_TYPE ? reg.byType(RULE_PACK_TYPE) : world.byType(type)),
    ...(rules === undefined ? {} : { rules }),
  };
}

const packFile = (): Record<string, unknown> => structuredClone(grittyTable);

/** Import the pack as the Homebrew page does: prepare, then Add and turn on. */
async function addPack(raw: unknown, applyTo?: PackAppliesTo) {
  const row = await homebrewRepo.prepare(raw, 'gritty-table.json');
  return { row, result: await commitHomebrewImport({ row }, undefined, applyTo) };
}

const packMoments = (doc: CharacterDoc, ctx: EngineContext) =>
  (deriveSheet(doc, ctx).moments?.moments ?? [])
    .filter((m) => m.from === 'Gritty Table')
    .map((m) => [m.at, m.do]);

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.settings.put({ key: 'dataTag', value: DATA_TAG });
  invalidateRegistry();
});

describe('a rule pack applied to a character', () => {
  it('changes their table rules, moments and effects, and nobody else’s', async () => {
    const before = deriveSheet(warrior('hild'), await context());
    const { result } = await addPack(packFile(), { characters: ['hild'] });
    expect(result).toEqual({ ok: true, message: 'Added "Gritty Table" and turned it on.' });
    const ctx = await context();

    const hild = deriveSheet(warrior('hild'), ctx);
    expect(hild.rules).toMatchObject({
      restLength: 'gritty',
      hpOnLongRest: 'half',
      critDamage: 'maxPlusRoll',
    });
    // Alert's +5 replaced by the pack's +1; Grit gains 5 feet of speed.
    expect(before.initiative.value).toBe(8);
    expect(hild.initiative.value).toBe(4);
    expect(hild.speedWalk.value).toBe(before.speedWalk.value + 5);
    expect(packMoments(warrior('hild'), ctx)).toEqual([
      ['zeroHp', [{ kind: 'addCondition', condition: 'Exhaustion', level: 1 }]],
      ['longRest', [{ kind: 'cue', text: 'A long rest needs a safe haven.', tone: 'warn' }]],
    ]);

    const bram = deriveSheet(warrior('bram'), ctx);
    // Every rule as written, so the sheet carries none.
    expect(bram.rules).toBeUndefined();
    expect(bram.initiative.value).toBe(8);
    expect(bram.speedWalk.value).toBe(before.speedWalk.value);
    expect(packMoments(warrior('bram'), ctx)).toEqual([]);
  });

  it('applied to every character, reaches each, its rules under a choice made in Settings', async () => {
    await addPack(packFile(), { characters: [], appDefault: true });
    const ctx = await context();
    for (const id of ['hild', 'bram']) {
      const sheet = deriveSheet(warrior(id), ctx);
      expect(sheet.rules?.restLength).toBe('gritty');
      expect(sheet.initiative.value).toBe(4);
      expect(packMoments(warrior(id), ctx)).toHaveLength(2);
    }
    const settings = deriveSheet(warrior('hild'), await context({ restLength: 'heroic' }));
    expect(settings.rules?.restLength).toBe('heroic');
    // A rule Settings leaves alone is still the pack's.
    expect(settings.rules?.critDamage).toBe('maxPlusRoll');
  });

  it('moves to whoever its Apply to names next', async () => {
    const { row } = await addPack(packFile(), { characters: ['hild'] });
    await savePackLocal(row.id, (local) => ({ ...local, appliesTo: { characters: ['bram'] } }));
    const ctx = await context();
    expect(deriveSheet(warrior('hild'), ctx).initiative.value).toBe(8);
    expect(deriveSheet(warrior('bram'), ctx).initiative.value).toBe(4);
  });

  it('turned off, reaches nobody', async () => {
    const { row } = await addPack(packFile(), { characters: ['hild'] });
    await homebrewRepo.setEnabled(row.id, false);
    invalidateRegistry();
    expect(deriveSheet(warrior('hild'), await context()).initiative.value).toBe(8);
  });
});

describe('a pick a pack adds', () => {
  it('is asked of whom the pack reaches, and the answer gives what it says', async () => {
    const file = packFile();
    const guidance = (file._meta as Record<string, unknown>).castGuidance as Record<
      string,
      unknown
    >;
    guidance.patches = [
      {
        target: 'Grit|Warrior',
        add: [
          {
            kind: 'pick',
            id: 'lore',
            ask: 'skill',
            from: ['Medicine', 'Nature'],
            gives: [{ kind: 'skillProf', skill: '{pick}', level: 1 }],
          },
        ],
      },
    ];
    await addPack(file, { characters: ['hild'] });
    const ctx = await context();
    const asked = deriveSheet(warrior('hild'), ctx).pending.filter((p) =>
      p.id.endsWith(':pick-lore'),
    );
    expect(asked).toEqual([expect.objectContaining({ kind: 'skill', count: 1 })]);
    expect(asked[0]?.options.map((o) => o.id)).toEqual(['Medicine', 'Nature']);
    expect(deriveSheet(warrior('bram'), ctx).pending.some((p) => p.id.endsWith(':pick-lore'))).toBe(
      false,
    );
    const doc = warrior('hild');
    doc.choices[asked[0]?.id ?? ''] = ['Nature'];
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.skills.Nature?.prof).toBe(1);
    expect(sheet.skills.Medicine?.prof).toBe(0);
  });
});

describe('who a pack applies to stays on this device', () => {
  it('leaves with a character it reaches, without its Apply to, and reaches nobody where it lands', async () => {
    const { row } = await addPack(packFile(), { characters: ['hild'] });
    const files = (await homebrewRepo.enabledSafe()).files;
    const stored = files.find((f) => f.id === row.id);
    expect(stored?.pack?.appliesTo).toEqual({ characters: ['hild'] });

    const forHild = homebrewForExport(warrior('hild'), files);
    expect(forHild).toHaveLength(1);
    expect((forHild[0]?.json as { _meta: object })._meta).not.toHaveProperty(PACK_LOCAL_KEY);
    expect(homebrewForExport(warrior('bram'), files)).toEqual([]);

    // Another device: the character's import stores the file as it came.
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.settings.put({ key: 'dataTag', value: DATA_TAG });
    invalidateRegistry();
    const arrived = await buildHomebrewRow(forHild[0]?.json, 'gritty-table.json');
    await db.transaction('rw', db.homebrewFiles, db.homebrewJson, () => putHomebrewRow(arrived));
    const there = await context();
    expect(there.byType(RULE_PACK_TYPE).map((p) => p.appliesTo)).toEqual([undefined]);
    expect(deriveSheet(warrior('hild'), there).initiative.value).toBe(8);
  });

  it('a file that arrives still holding another device’s Apply to reaches nobody', async () => {
    const { row } = await addPack(packFile(), { characters: [], appDefault: true });
    const stored = (await homebrewRepo.getSafe(row.id)).file?.json;
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.settings.put({ key: 'dataTag', value: DATA_TAG });
    invalidateRegistry();
    const arrived = await buildHomebrewRow(stored, 'gritty-table.json');
    await db.transaction('rw', db.homebrewFiles, db.homebrewJson, () => putHomebrewRow(arrived));
    const there = await context();
    expect(there.byType(RULE_PACK_TYPE)).toHaveLength(1);
    expect(there.byType(RULE_PACK_TYPE)[0]).not.toHaveProperty('appliesTo');
    expect(deriveSheet(warrior('hild'), there).rules).toBeUndefined();
  });

  it('imported, sets aside the Apply to it came with for the one chosen here', async () => {
    const raw = packFile();
    (raw._meta as Record<string, unknown>)[PACK_LOCAL_KEY] = {
      file: 'whatever',
      appliesTo: { characters: [], appDefault: true },
    };
    const { row } = await addPack(structuredClone(raw), { characters: ['hild'] });
    const ctx = await context();
    expect(ctx.byType(RULE_PACK_TYPE)[0]?.appliesTo).toEqual({ characters: ['hild'] });
    // Stored as it came, the block it came with read as nothing.
    const stored = (await homebrewRepo.getSafe(row.id)).file;
    expect(stored?.json).toEqual(raw);
    expect(stored?.pack).toEqual({ appliesTo: { characters: ['hild'] } });
  });
});

describe('suspected bug 10: the pack review and an imported file', () => {
  it('keeps the stored file what was imported, through the import and a new Apply to', async () => {
    const { row } = await addPack(packFile(), { characters: ['hild'] });
    expect((await homebrewRepo.getSafe(row.id)).file?.json).toEqual(packFile());
    await savePackLocal(row.id, (local) => ({ ...local, appliesTo: { characters: ['bram'] } }));
    expect((await homebrewRepo.getSafe(row.id)).file?.json).toEqual(packFile());
    expect(deriveSheet(warrior('bram'), await context()).initiative.value).toBe(4);
  });
});

/** The pack file, changed: its rest is heroic, and it still replaces Alert. */
function changedPack(): Record<string, unknown> {
  const raw = packFile();
  const guidance = (raw._meta as { castGuidance: Record<string, unknown> }).castGuidance;
  guidance.tableRules = { restLength: 'heroic' };
  return raw;
}

describe('a changed pack imported again (ADR-002, D4)', () => {
  it('updates the same collection: its switch, place and characters kept, the file as it came', async () => {
    const { row } = await addPack(packFile(), { characters: ['hild'] });
    await savePackLocal(row.id, (local) => ({ ...local, order: 2 }));
    await homebrewRepo.setEnabled(row.id, false);
    const before = (await homebrewRepo.getSafe(row.id)).file;
    // The dialog's choice is every character; the update keeps the pack's own.
    const next = await homebrewRepo.prepare(changedPack(), 'gritty-table.json');
    const result = await commitHomebrewImport({ row: next }, undefined, {
      characters: [],
      appDefault: true,
    });
    expect(result).toEqual({
      ok: true,
      message: 'Updated "Gritty Table". It applies to whoever it did before.',
    });

    const { files } = await homebrewRepo.listSafe();
    expect(files).toHaveLength(1);
    const after = files[0];
    expect(after?.json).toEqual(changedPack());
    expect(after?.enabled).toBe(false);
    expect(after?.addedAt).toBe(before?.addedAt);
    expect(after?.pack).toEqual({ appliesTo: { characters: ['hild'] }, order: 2 });

    if (after === undefined) throw new Error('not stored');
    await homebrewRepo.setEnabled(after.id, true);
    invalidateRegistry();
    const ctx = await context();
    expect(deriveSheet(warrior('hild'), ctx).rules?.restLength).toBe('heroic');
    expect(deriveSheet(warrior('hild'), ctx).initiative.value).toBe(4);
    expect(deriveSheet(warrior('bram'), ctx).initiative.value).toBe(8);
  });
});

describe('a pack applied on a device from before the version 6 upgrade', () => {
  /** The database as version 5 left it, with the pack applied as it was then: in its file. */
  async function oldDevice(appliesTo: PackAppliesTo) {
    db.close();
    await Dexie.delete('cast-guidance');
    const old = new Dexie('cast-guidance');
    old.version(5).stores({
      dataFiles: 'key, tag, pack, bytes',
      dataMeta: 'id',
      characters: 'id, name, updatedAt',
      homebrewFiles: 'id, enabled, addedAt',
      homebrewJson: 'id',
      searchIndexes: 'key',
      settings: 'key',
      rollLog: 'id, at, charId',
      characterHistory: 'id, charId, at, [charId+at]',
    });
    const row = await buildHomebrewRow(packFile(), 'gritty-table.json');
    const { json, key: _, ...meta } = row;
    const held = structuredClone(json) as { _meta: Record<string, unknown> };
    held._meta[PACK_LOCAL_KEY] = { file: row.id, appliesTo, order: 1 };
    await old.table('homebrewFiles').put({ ...meta, rev: 1 });
    await old.table('homebrewJson').put({ id: row.id, json: held });
    await old.table('settings').put({ key: 'dataTag', value: DATA_TAG });
    old.close();
    await db.open();
    invalidateRegistry();
    return row;
  }

  it('reaches the same characters after it, its Apply to read once onto the row', async () => {
    const row = await oldDevice({ characters: ['hild'] });
    const ctx = await context();
    expect(deriveSheet(warrior('hild'), ctx).initiative.value).toBe(4);
    expect(deriveSheet(warrior('bram'), ctx).initiative.value).toBe(8);
    const stored = (await homebrewRepo.getSafe(row.id)).file;
    expect(stored?.pack).toEqual({ appliesTo: { characters: ['hild'] }, order: 1 });
    // The file is what was imported again, without the block.
    expect(stored?.json).toEqual(packFile());
  });

  it('is updated, not copied, by its first import again', async () => {
    const row = await oldDevice({ characters: [], appDefault: true });
    const next = await homebrewRepo.prepare(changedPack(), 'gritty-table.json');
    await commitHomebrewImport({ row: next }, undefined, { characters: ['bram'] });
    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => [f.id, f.pack])).toEqual([
      [next.id, { appliesTo: { characters: [], appDefault: true }, order: 1 }],
    ]);
    expect(files[0]?.id).not.toBe(row.id);
    const ctx = await context();
    expect(deriveSheet(warrior('hild'), ctx).rules?.restLength).toBe('heroic');
  });
});

describe('a pack past a limit', () => {
  it('is refused with the reason, and nothing is stored', async () => {
    const raw = packFile();
    const guidance = (raw._meta as { castGuidance: Record<string, unknown> }).castGuidance;
    guidance.moments = Array(201).fill({ at: 'zeroHp', do: [] });
    const { result } = await addPack(raw, { characters: ['hild'] });
    expect(result).toEqual({
      ok: false,
      message: '"Gritty Table" was not added: it has 201 moments; a pack has at most 200.',
    });
    expect(await db.homebrewFiles.count()).toBe(0);
  });
});
