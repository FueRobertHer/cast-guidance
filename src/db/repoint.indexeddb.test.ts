// Moving or renaming an entry keeps it on every sheet (ADR-002, D5): the move
// and the rename, each one write over the player's files and every character,
// and a real build derived before and after.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_TAG } from '@/data5e/config';
import { getRegistry, invalidateRegistry } from '@/data5e/registry';
import { RULE_SET_TYPE } from '@/engine/castGuidance';
import { deriveSheet } from '@/engine/derive';
import {
  type CharacterDoc,
  type DerivedSheet,
  type EngineContext,
  newCharacterDoc,
} from '@/engine/types';
import { makeTestContext } from '../../tests-fixtures/testWorld';
import { characterRepo } from './characterRepo';
import { db } from './db';
import { EntryClash, homebrewRepo } from './homebrewRepo';
import { MoveRefused, type MoveRequest } from './repoint';

type Row = Record<string, unknown>;

const ASH = 'ASH';
const BONE = 'BONE';

/** One collection's worth of the player's entries, every type a move re-points. */
function ashContent(source = ASH): Row {
  return {
    feat: [
      { name: 'Keen Study', source, skillProficiencies: [{ any: 2 }], entries: ['Two skills.'] },
    ],
    background: [
      {
        name: 'Ash Scribe',
        source,
        skillProficiencies: [{ choose: { from: ['arcana', 'history'], count: 1 } }],
        feats: [{ 'skilled|tst': true }],
        entries: ['You copied books.'],
      },
    ],
    optionalfeature: [
      { name: 'Ash Guard', source, featureType: ['FS:T'], entries: ['Ash guards you.'] },
    ],
    race: [
      {
        name: 'Kilnborn',
        source,
        speed: 35,
        skillProficiencies: [{ choose: { from: ['stealth', 'survival'], count: 1 } }],
        entries: [{ name: 'Kiln Heart', type: 'entries', entries: ['Warm.'] }],
      },
    ],
    subrace: [
      {
        name: 'Deep Hollow',
        source,
        raceName: 'Kilnborn',
        raceSource: source,
        // Its own pick, beside the species' skill pick it leaves in place.
        languageProficiencies: [{ anyStandard: 1 }],
        entries: [{ name: 'Hollow Sight', type: 'entries', entries: ['Dark.'] }],
      },
    ],
    item: [
      {
        name: 'Ember Rod',
        source,
        type: 'RD',
        rarity: 'rare',
        additionalSpells: [
          { ability: 'cha', innate: { _: { daily: { '1': ['searing bolt|tst'] } } } },
        ],
        entries: ['Casts searing bolt once a day.'],
      },
    ],
    spell: [{ name: 'Smolder', source, level: 1, school: 'V', entries: ['It smolders.'] }],
    class: [
      {
        name: 'Hexer',
        source,
        hd: { number: 1, faces: 8 },
        proficiency: ['cha', 'wis'],
        spellcastingAbility: 'cha',
        casterProgression: 'full',
        spellsKnownProgression: [2, 3, 4],
        classFeatures: [
          `Hex Bolt|Hexer|${source}|1`,
          { classFeature: `Path Choice|Hexer|${source}|1`, gainSubclassFeature: true },
        ],
        subclassTitle: 'Way',
        entries: ['A hexer.'],
      },
    ],
    classFeature: [
      {
        name: 'Hex Bolt',
        source,
        className: 'Hexer',
        classSource: source,
        level: 1,
        entries: ['A bolt.'],
      },
      {
        name: 'Path Choice',
        source,
        className: 'Hexer',
        classSource: source,
        level: 1,
        entries: ['Choose a way.'],
      },
    ],
    subclass: [
      {
        name: 'Way of Coals',
        shortName: 'Coals',
        source,
        className: 'Hexer',
        classSource: source,
        subclassFeatures: [`Coal Heart|Hexer|${source}|Coals|${source}|1`],
      },
    ],
    subclassFeature: [
      {
        name: 'Coal Heart',
        source,
        className: 'Hexer',
        classSource: source,
        subclassShortName: 'Coals',
        subclassSource: source,
        level: 1,
        entries: ['Your heart burns.'],
      },
    ],
  };
}

/** Every entry in `ashContent`, as a move asks for it. */
const EVERY: MoveRequest['entries'] = [
  ['feat', 'Keen Study'],
  ['background', 'Ash Scribe'],
  ['optionalfeature', 'Ash Guard'],
  ['race', 'Kilnborn'],
  ['subrace', 'Deep Hollow'],
  ['item', 'Ember Rod'],
  ['spell', 'Smolder'],
  ['class', 'Hexer'],
  ['subclass', 'Way of Coals'],
].map(([type, name]) => ({ type: type as string, name: name as string, source: ASH }));

/** A collection the player made, holding `content`. */
async function collection(full: string, abbreviation: string, content: Row = {}) {
  const row = await homebrewRepo.createEditable(full, abbreviation);
  await homebrewRepo.saveEditable(row.id, { ...(row.json as Row), ...content });
  return row.id;
}

async function content(id: string): Promise<Row> {
  const file = (await homebrewRepo.ownedSafe()).files.find((f) => f.id === id);
  if (file === undefined) throw new Error(`no file ${id}`);
  return file.json;
}

/** Everything stored, to show a refused or failed write changed nothing. */
async function snapshot() {
  return {
    files: await db.homebrewFiles.toArray(),
    json: await db.homebrewJson.toArray(),
    characters: await db.characters.toArray(),
  };
}

async function putCharacter(doc: CharacterDoc) {
  await db.characters.put({ ...doc, revision: 'r0' });
}

/** A warrior who took Keen Study at 4th level, and the skills it gave. */
function grog(source = ASH): CharacterDoc {
  const doc = newCharacterDoc('grog', 'Grog', 'test-tag');
  const uid = `keen study|${source.toLowerCase()}`;
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: [] }];
  doc.feats = [{ ref: { name: 'Keen Study', source }, instanceId: 'asi4@warrior|tst' }];
  doc.choices = {
    'class:warrior|tst:asi:4': 'feat',
    'class:warrior|tst:asi:4:feat': uid,
    [`feat:${uid}:asi4@warrior|tst:skill:0`]: ['Arcana', 'Nature'],
  };
  doc.homebrewDeps = [source];
  return doc;
}

const keenStudy = (source: string): Row & { name: string; source: string } => ({
  name: 'Keen Study',
  source,
  skillProficiencies: [{ any: 2 }],
  entries: ['Two skills.'],
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.settings.put({ key: 'dataTag', value: DATA_TAG });
  invalidateRegistry();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('homebrewRepo.moveEntries', () => {
  it('gives the entry its new collection’s source and re-points every character that held it', async () => {
    const ash = await collection('Ash Book', ASH, { feat: [keenStudy(ASH)] });
    const bone = await collection('Bone Book', BONE);
    await putCharacter(grog());
    // Bram depends on the collection, but holds nothing that moves.
    const other = newCharacterDoc('bram', 'Bram', 'test-tag');
    other.homebrewDeps = [ASH];
    await putCharacter(other);
    const was = await db.characters.get('grog');

    const report = await homebrewRepo.moveEntries({
      from: ash,
      to: bone,
      entries: [{ type: 'feat', name: 'keen study', source: 'ash' }],
    });

    expect(report).toEqual({
      changes: [
        {
          type: 'feat',
          from: { name: 'Keen Study', source: ASH },
          to: { name: 'Keen Study', source: BONE },
        },
      ],
      characters: ['grog'],
      skipped: [],
      packs: [],
      imported: [],
    });
    expect((await content(ash)).feat).toEqual([]);
    expect((await content(bone)).feat).toEqual([keenStudy(BONE)]);
    const row = await db.characters.get('grog');
    const moved = grog(BONE);
    expect(row).toEqual({
      ...was,
      feats: moved.feats,
      choices: moved.choices,
      homebrewDeps: [ASH, BONE],
      revision: row?.revision,
    });
    expect(row?.revision).not.toBe('r0');
    // A character that held none of it is not written.
    expect((await db.characters.get('bram'))?.revision).toBe('r0');
    // The registry reads the move at once.
    const reg = await getRegistry();
    expect(reg.get('feat', 'Keen Study', BONE)).toBeDefined();
    expect(reg.get('feat', 'Keen Study', ASH)).toBeUndefined();
  });

  it('moves a class with its own features, and a subclass with its, refs and all', async () => {
    const ash = await collection('Ash Book', ASH, ashContent());
    const bone = await collection('Bone Book', BONE);
    await homebrewRepo.moveEntries({
      from: ash,
      to: bone,
      entries: EVERY.filter((e) => e.type === 'class' || e.type === 'subclass'),
    });
    const moved = ashContent(BONE);
    const after = await content(bone);
    for (const type of ['class', 'classFeature', 'subclass', 'subclassFeature']) {
      expect(after[type], type).toEqual(moved[type]);
      expect((await content(ash))[type], type).toEqual([]);
    }
  });

  it('carries a class’s subclasses left behind over to its new source', async () => {
    const ash = await collection('Ash Book', ASH, ashContent());
    const bone = await collection('Bone Book', BONE);
    await homebrewRepo.moveEntries({
      from: ash,
      to: bone,
      entries: EVERY.filter((e) => e.type === 'class'),
    });
    const left = await content(ash);
    expect(left.subclass).toEqual([
      expect.objectContaining({
        source: ASH,
        classSource: BONE,
        subclassFeatures: [`Coal Heart|Hexer|${BONE}|Coals|${ASH}|1`],
      }),
    ]);
    expect(left.subclassFeature).toEqual([
      expect.objectContaining({ classSource: BONE, subclassSource: ASH }),
    ]);
    expect((await content(bone)).classFeature).toEqual(ashContent(BONE).classFeature);
  });

  it('carries a moved race’s subraces with it, wherever they are', async () => {
    const ash = await collection('Ash Book', ASH, ashContent());
    const bone = await collection('Bone Book', BONE);
    await homebrewRepo.moveEntries({
      from: ash,
      to: bone,
      entries: EVERY.filter((e) => e.type === 'race'),
    });
    expect((await content(ash)).subrace).toEqual([
      expect.objectContaining({ source: ASH, raceName: 'Kilnborn', raceSource: BONE }),
    ]);
  });

  it('turns the player’s own pack changes to it, and lists imported packs that name it', async () => {
    const ash = await collection('Ash Book', ASH, { feat: [keenStudy(ASH)] });
    const bone = await collection('Bone Book', BONE);
    const guidance = (target: string) => ({
      v: 1,
      patches: [
        { target, add: [{ kind: 'acBonus', amount: 1 }] },
        { target: 'Alert|PHB', add: [{ kind: 'acBonus', amount: 1 }] },
      ],
    });
    const own = await collection('My Pack', 'MYPK');
    const ownJson = await content(own);
    await homebrewRepo.saveEditable(own, {
      ...ownJson,
      _meta: { ...(ownJson._meta as Row), castGuidance: guidance('Keen Study|ASH') },
    });
    const imported = await homebrewRepo.importJson(
      {
        _meta: {
          sources: [{ json: 'GT', full: 'Gritty Table' }],
          castGuidance: guidance(' keen study|ash '),
        },
      },
      'gritty.json',
    );
    const importedBefore = await db.homebrewJson.get(imported.id);

    const report = await homebrewRepo.moveEntries({
      from: ash,
      to: bone,
      entries: [{ type: 'feat', name: 'Keen Study', source: ASH }],
    });

    expect(report.packs).toEqual([own]);
    const patches = ((await content(own))._meta as { castGuidance: { patches: Row[] } })
      .castGuidance.patches;
    expect(patches.map((p) => p.target)).toEqual(['Keen Study|BONE', 'Alert|PHB']);
    expect(report.imported).toEqual([
      {
        fileId: imported.id,
        fileName: 'gritty.json',
        pack: 'Gritty Table',
        targets: [' keen study|ash '],
      },
    ]);
    // An imported pack is left as it came.
    expect(await db.homebrewJson.get(imported.id)).toEqual(importedBefore);
  });

  it('leaves a feat’s picks alone when an optional feature of its name and book moves', async () => {
    const twin = (extra: Row) => ({ name: 'Twin Edge', source: ASH, entries: ['Two.'], ...extra });
    const ash = await collection('Ash Book', ASH, {
      feat: [twin({ skillProficiencies: [{ any: 1 }] })],
      optionalfeature: [twin({ featureType: ['FS:T'], skillProficiencies: [{ any: 1 }] })],
    });
    const bone = await collection('Bone Book', BONE);
    const doc = newCharacterDoc('osk', 'Osk', 'test-tag');
    doc.choices = {
      'class:warrior|tst:asi:4:feat': 'twin edge|ash',
      'feat:twin edge|ash:asi4:skill:0': ['Arcana'],
      'class:warrior|tst:optfeature:FS:T': ['twin edge|ash'],
      'spells-of:twin edge|ash:0': ['Aid|TST'],
    };
    await putCharacter(doc);
    await homebrewRepo.moveEntries({
      from: ash,
      to: bone,
      entries: [{ type: 'optionalfeature', name: 'Twin Edge', source: ASH }],
    });
    expect((await characterRepo.get('osk'))?.choices).toEqual({
      'class:warrior|tst:asi:4:feat': 'twin edge|ash',
      'feat:twin edge|ash:asi4:skill:0': ['Arcana'],
      'class:warrior|tst:optfeature:FS:T': ['twin edge|bone'],
      'spells-of:twin edge|bone:0': ['Aid|TST'],
    });
  });

  it('names a character it could not read, and moves the rest', async () => {
    const ash = await collection('Ash Book', ASH, { feat: [keenStudy(ASH)] });
    const bone = await collection('Bone Book', BONE);
    await putCharacter(grog());
    const newer = { ...grog(), id: 'later', schemaVersion: 999 };
    await db.characters.put({ ...newer, revision: 'r0' });
    const report = await homebrewRepo.moveEntries({
      from: ash,
      to: bone,
      entries: [{ type: 'feat', name: 'Keen Study', source: ASH }],
    });
    expect(report.characters).toEqual(['grog']);
    expect(report.skipped).toEqual(['later']);
    expect(await db.characters.get('later')).toEqual({ ...newer, revision: 'r0' });
  });

  describe('refuses a move it cannot make, and changes nothing', () => {
    const refusals: Array<
      [string, (ids: { ash: string; bone: string }) => Promise<MoveRequest>, unknown]
    > = [
      [
        'an entry of that name already in the target',
        async ({ ash, bone }) => {
          await homebrewRepo.saveEditable(bone, {
            ...(await content(bone)),
            feat: [keenStudy(BONE)],
          });
          return {
            from: ash,
            to: bone,
            entries: [{ type: 'feat', name: 'Keen Study', source: ASH }],
          };
        },
        EntryClash,
      ],
      [
        'one of a class’s features already in the target',
        async ({ ash, bone }) => {
          const theirs = ashContent(BONE).classFeature as Row[];
          await homebrewRepo.saveEditable(bone, { ...(await content(bone)), classFeature: theirs });
          return { from: ash, to: bone, entries: EVERY.filter((e) => e.type === 'class') };
        },
        EntryClash,
      ],
      [
        'an entry not in the collection, beside one that is',
        async ({ ash, bone }) => ({
          from: ash,
          to: bone,
          entries: [
            { type: 'feat', name: 'Keen Study', source: ASH },
            { type: 'feat', name: 'Missing', source: ASH },
          ],
        }),
        MoveRefused,
      ],
      [
        'an imported collection',
        async ({ ash }) => {
          const row = await homebrewRepo.importJson(
            { _meta: { sources: [{ json: 'IMP', full: 'Imported' }] }, feat: [keenStudy('IMP')] },
            'imported.json',
          );
          return {
            from: row.id,
            to: ash,
            entries: [{ type: 'feat', name: 'Keen Study', source: 'IMP' }],
          };
        },
        MoveRefused,
      ],
      [
        'the changes to the books',
        async ({ ash }) => {
          const { fileId } = await homebrewRepo.saveEntry(
            'feat',
            { name: 'Alert', source: 'PHB', entries: ['Changed.'] },
            { role: 'changes' },
          );
          return {
            from: ash,
            to: fileId,
            entries: [{ type: 'feat', name: 'Keen Study', source: ASH }],
          };
        },
        MoveRefused,
      ],
      [
        'two collections with one source',
        async ({ ash, bone }) => {
          await db.homebrewFiles.update(bone, { sourceIds: [ASH] });
          return {
            from: ash,
            to: bone,
            entries: [{ type: 'feat', name: 'Keen Study', source: ASH }],
          };
        },
        MoveRefused,
      ],
      [
        'one collection to itself',
        async ({ ash }) => ({
          from: ash,
          to: ash,
          entries: [{ type: 'feat', name: 'Keen Study', source: ASH }],
        }),
        MoveRefused,
      ],
      [
        'a subclass whose features one of its short name in the target would share',
        async ({ ash, bone }) => {
          const twin = { ...(ashContent(BONE).subclass as Row[])[0], name: 'Way of Ashes' };
          await homebrewRepo.saveEditable(bone, { ...(await content(bone)), subclass: [twin] });
          return { from: ash, to: bone, entries: EVERY.filter((e) => e.type === 'subclass') };
        },
        MoveRefused,
      ],
      [
        'a subclass whose features another of its short name shares',
        async ({ ash, bone }) => {
          const json = await content(ash);
          const twin = { ...(json.subclass as Row[])[0], name: 'Way of Ashes' };
          await homebrewRepo.saveEditable(ash, {
            ...json,
            subclass: [...(json.subclass as Row[]), twin],
          });
          return { from: ash, to: bone, entries: EVERY.filter((e) => e.type === 'subclass') };
        },
        MoveRefused,
      ],
    ];

    it.each(refusals)('%s', async (_, setUp, error) => {
      const ash = await collection('Ash Book', ASH, ashContent());
      const bone = await collection('Bone Book', BONE);
      await putCharacter(grog());
      const req = await setUp({ ash, bone });
      const before = await snapshot();
      await expect(homebrewRepo.moveEntries(req)).rejects.toBeInstanceOf(error);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('a failure part way through leaves nothing changed', () => {
    it('when the characters cannot be written', async () => {
      const ash = await collection('Ash Book', ASH, ashContent());
      const bone = await collection('Bone Book', BONE);
      await putCharacter(grog());
      const before = await snapshot();
      vi.spyOn(db.characters, 'bulkPut').mockRejectedValueOnce(new Error('disk full'));
      await expect(
        homebrewRepo.moveEntries({ from: ash, to: bone, entries: EVERY }),
      ).rejects.toThrow('disk full');
      expect(await snapshot()).toEqual(before);
    });

    it('when the second collection cannot be written', async () => {
      const ash = await collection('Ash Book', ASH, ashContent());
      const bone = await collection('Bone Book', BONE);
      await putCharacter(grog());
      const before = await snapshot();
      const put = db.homebrewJson.put.bind(db.homebrewJson);
      let writes = 0;
      vi.spyOn(db.homebrewJson, 'put').mockImplementation(((...args: Parameters<typeof put>) => {
        writes += 1;
        return writes === 2 ? Promise.reject(new Error('disk full')) : put(...args);
      }) as typeof put);
      await expect(
        homebrewRepo.moveEntries({ from: ash, to: bone, entries: EVERY }),
      ).rejects.toThrow('disk full');
      expect(writes).toBe(2);
      expect(await snapshot()).toEqual(before);
    });
  });
});

describe('homebrewRepo.saveEntry, renaming', () => {
  it('re-points every character that held the entry, in the save’s write', async () => {
    const ash = await collection('Ash Book', ASH, { feat: [keenStudy(ASH)] });
    await putCharacter(grog());
    const result = await homebrewRepo.saveEntry(
      'feat',
      { ...keenStudy(ASH), name: 'Sharp Study' },
      { fileId: ash, replaces: { name: 'Keen Study', source: ASH } },
    );
    expect(result).toEqual({
      fileId: ash,
      created: false,
      repointed: {
        changes: [
          {
            type: 'feat',
            from: { name: 'Keen Study', source: ASH },
            to: { name: 'Sharp Study', source: ASH },
          },
        ],
        characters: ['grog'],
        skipped: [],
        packs: [],
        imported: [],
      },
    });
    const doc = await characterRepo.get('grog');
    expect(doc?.feats[0]?.ref).toEqual({ name: 'Sharp Study', source: ASH });
    expect(doc?.choices).toEqual({
      'class:warrior|tst:asi:4': 'feat',
      'class:warrior|tst:asi:4:feat': 'sharp study|ash',
      'feat:sharp study|ash:asi4@warrior|tst:skill:0': ['Arcana', 'Nature'],
    });
  });

  it('re-points nothing when the save keeps the name and book', async () => {
    const ash = await collection('Ash Book', ASH, { feat: [keenStudy(ASH)] });
    await putCharacter(grog());
    const result = await homebrewRepo.saveEntry(
      'feat',
      { ...keenStudy(ASH), entries: ['Two skills, well.'] },
      { fileId: ash, replaces: { name: 'Keen Study', source: ASH } },
    );
    expect(result).toEqual({ fileId: ash, created: false });
    expect((await db.characters.get('grog'))?.revision).toBe('r0');
  });

  it('never re-points a change to the books, which keeps the book’s name', async () => {
    await homebrewRepo.saveEntry(
      'feat',
      { name: 'Alert', source: 'PHB', entries: ['Changed.'] },
      { role: 'changes' },
    );
    const doc = newCharacterDoc('hild', 'Hild', 'test-tag');
    doc.feats = [
      { ref: { name: 'Alert', source: 'PHB' }, instanceId: 'asi4@warrior|tst' },
      { ref: { name: 'Lucky', source: 'PHB' }, instanceId: 'bonus' },
    ];
    await putCharacter(doc);
    const result = await homebrewRepo.saveEntry(
      'feat',
      { name: 'Alertness', source: 'PHB', entries: ['Changed.'] },
      { role: 'changes', replaces: { name: 'Alert', source: 'PHB' } },
    );
    expect(result).not.toHaveProperty('repointed');
    // Nor when the Workshop opens a change by its file, as it does.
    await homebrewRepo.saveEntry(
      'feat',
      { name: 'Lucky', source: 'PHB', entries: ['Changed.'] },
      { role: 'changes' },
    );
    const byFile = await homebrewRepo.saveEntry(
      'feat',
      { name: 'Luckier', source: 'PHB', entries: ['Changed.'] },
      { fileId: result.fileId, replaces: { name: 'Lucky', source: 'PHB' } },
    );
    expect(byFile).toEqual({ fileId: result.fileId, created: false });
    expect((await db.characters.get('hild'))?.revision).toBe('r0');
  });

  it('saves nothing when the characters cannot be written', async () => {
    const ash = await collection('Ash Book', ASH, { feat: [keenStudy(ASH)] });
    await putCharacter(grog());
    const before = await snapshot();
    vi.spyOn(db.characters, 'bulkPut').mockRejectedValueOnce(new Error('disk full'));
    await expect(
      homebrewRepo.saveEntry(
        'feat',
        { ...keenStudy(ASH), name: 'Sharp Study' },
        { fileId: ash, replaces: { name: 'Keen Study', source: ASH } },
      ),
    ).rejects.toThrow('disk full');
    expect(await snapshot()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// A real build, derived before and after
// ---------------------------------------------------------------------------

/** The test world beside the registry's homebrew, as the engine reads both. */
async function context(): Promise<EngineContext> {
  const reg = await getRegistry();
  const world = makeTestContext();
  return {
    ...world,
    get: (type, name, source) =>
      world.get(type, name, source) ?? reg.get(type as never, name, source),
    byType: (type) =>
      type === RULE_SET_TYPE
        ? world.byType(type)
        : [...world.byType(type), ...reg.byType(type as never)],
  };
}

/** Every open pick answered with its first options, until none is left to answer. */
function answerAll(doc: CharacterDoc, ctx: EngineContext): CharacterDoc {
  let next = doc;
  for (let round = 0; round < 10; round++) {
    const open = deriveSheet(next, ctx).pending.filter((p) => next.choices[p.id] === undefined);
    if (open.length === 0) return next;
    const choices = { ...next.choices };
    for (const p of open) {
      choices[p.id] = p.options
        .filter((o) => o.disabled === undefined)
        .slice(0, p.count)
        .map((o) => o.id);
    }
    next = { ...next, choices };
  }
  throw new Error('the picks never settled');
}

/** The sheet as a player reads it, with no entry's source in it. */
function view(s: DerivedSheet) {
  return {
    warnings: s.warnings,
    pending: s.pending.map((p) => p.label).sort(),
    resolved: s.resolvedChoices.map((r) => `${r.prompt.label}: ${r.selected.length}`).sort(),
    features: s.features.map((f) => f.name).sort(),
    granted: s.grantedSpells
      .map((g) => `${g.name} ${g.usage ?? ''} ${g.resourceKey === undefined ? '' : 'pooled'}`)
      .sort(),
    resources: s.resources.map((r) => `${r.label} ${r.max}`).sort(),
    skills: Object.entries(s.skills)
      .filter(([, v]) => v.prof !== 0)
      .map(([k]) => k)
      .sort(),
    speed: s.speedWalk.value,
    hp: s.maxHp.value,
    casting: s.spellcasting.map((b) => b.className),
  };
}

/** `v` as it reads with each old name in `names` replaced by its new one. */
function renamedView<T>(v: T, names: ReadonlyArray<readonly [string, string, string]>): T {
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') return names.reduce((s, [, from, to]) => s.replaceAll(from, to), x);
    if (Array.isArray(x)) {
      const out = x.map(walk);
      return out.every((e) => typeof e === 'string') ? out.sort() : out;
    }
    if (typeof x === 'object' && x !== null) {
      return Object.fromEntries(Object.entries(x).map(([k, e]) => [k, walk(e)]));
    }
    return x;
  };
  return walk(v) as T;
}

/** What a sheet spends and casts from: each must still be found after a move. */
function holds(doc: CharacterDoc, s: DerivedSheet, ctx: EngineContext) {
  const keys = new Set(s.resources.map((r) => r.key));
  expect(doc.play.resources.map((r) => r.key).filter((k) => !keys.has(k))).toEqual([]);
  expect(
    s.grantedSpells.filter((g) => g.resourceKey !== undefined && !keys.has(g.resourceKey)),
  ).toEqual([]);
  for (const block of s.spellcasting) {
    const known = doc.spellcasting[block.classUid]?.known ?? [];
    expect(known.length, block.className).toBeGreaterThan(0);
    for (const k of known) expect(ctx.get('spell', k.name, k.source), k.name).toBeDefined();
  }
}

/** A warrior of the player's species and background, who took their feat and fighting style and carries their rod. */
function warrior(): CharacterDoc {
  const doc = newCharacterDoc('grog', 'Grog', 'test-tag');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 };
  doc.race = { name: 'Kilnborn', source: ASH };
  doc.subrace = { name: 'Deep Hollow', source: ASH };
  doc.background = { name: 'Ash Scribe', source: ASH };
  doc.classes = [
    { ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: ['avg', 'avg', 'avg', 'avg'] },
  ];
  doc.choices = {
    'class:warrior|tst:optfeature:FS:T': ['ash guard|ash'],
    'class:warrior|tst:asi:4': 'feat',
    'class:warrior|tst:asi:4:feat': 'keen study|ash',
  };
  doc.equipment = [
    { id: 'rod', ref: { name: 'Ember Rod', source: ASH }, qty: 1, equipped: true, attuned: true },
  ];
  doc.addedSpells = [{ spell: { name: 'Smolder', source: ASH }, ability: 'wis', uses: 'long' }];
  doc.homebrewDeps = [ASH];
  return doc;
}

/** A hexer of the player's own class and subclass, who knows their spell. */
function hexer(): CharacterDoc {
  const doc = newCharacterDoc('mira', 'Mira', 'test-tag');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 };
  doc.race = { name: 'Testfolk', source: 'TST' };
  doc.classes = [
    {
      ref: { name: 'Hexer', source: ASH },
      subclass: { name: 'Way of Coals', source: ASH },
      levels: 1,
      hp: [],
    },
  ];
  doc.choices = { 'race:testfolk|tst:lang:0': ['Elvish'] };
  doc.spellcasting = { 'hexer|ash': { known: [{ name: 'Smolder', source: ASH }], prepared: [] } };
  doc.homebrewDeps = [ASH];
  return doc;
}

/** Both builds, every pick answered and a use spent from every spell pool. */
async function built(): Promise<{ docs: CharacterDoc[]; ctx: EngineContext }> {
  const ctx = await context();
  const docs = [warrior(), hexer()].map((d) => {
    const doc = answerAll(d, ctx);
    const pools = deriveSheet(doc, ctx).resources.filter((r) => r.key.startsWith('spell:'));
    return {
      ...doc,
      play: { ...doc.play, resources: pools.map((r) => ({ key: r.key, used: 1 })) },
    };
  });
  for (const doc of docs) await putCharacter(doc);
  return { docs, ctx };
}

async function stored(ids: readonly string[]): Promise<CharacterDoc[]> {
  return Promise.all(
    ids.map(async (id) => {
      const doc = await characterRepo.get(id);
      if (doc === undefined) throw new Error(`no character ${id}`);
      return doc;
    }),
  );
}

/** Rename one entry in the Workshop, as its editor saves it. */
async function renameEntry(file: string, type: string, from: string, to: string) {
  const json = await content(file);
  const source = String((json._meta as { sources: Array<{ json: string }> }).sources[0]?.json);
  const entry = (json[type] as Row[]).find((e) => e.name === from) as Row;
  const opts: Parameters<typeof homebrewRepo.saveEntry>[2] = {
    fileId: file,
    replaces: { name: from, source },
  };
  let renamed: Row = { ...entry, name: to };
  if (type === 'class') {
    // The class editor saves the class's features with it, under its new name.
    renamed = {
      ...renamed,
      classFeatures: [
        `Hex Bolt|${to}|${source}|1`,
        { classFeature: `Path Choice|${to}|${source}|1`, gainSubclassFeature: true },
      ],
    };
    opts.owned = (json.classFeature as Row[]).map((f) => ({ ...f, className: to }));
  }
  return homebrewRepo.saveEntry(type, renamed as Row & { name: string; source: string }, opts);
}

describe('a real build, derived before and after', () => {
  it('derives the same once every entry it uses has moved', async () => {
    const ash = await collection('Ash Book', ASH, ashContent());
    const bone = await collection('Bone Book', BONE);
    const { docs, ctx } = await built();
    const before = docs.map((d) => deriveSheet(d, ctx));
    // The build is what it says: every entry found, every pick it holds made.
    for (const s of before) expect(s.warnings).toEqual([]);
    expect(view(before[0] as DerivedSheet).features).toEqual(
      expect.arrayContaining([
        'Keen Study',
        'Combat Stance: Ash Guard',
        'Kilnborn',
        'Deep Hollow',
        'Ash Scribe',
        'Skilled',
      ]),
    );
    expect(view(before[1] as DerivedSheet).features).toEqual(
      expect.arrayContaining(['Hex Bolt', 'Coal Heart']),
    );
    expect(Object.keys(docs[0]?.choices ?? {})).toEqual(
      expect.arrayContaining([
        'race:kilnborn|ash:skill:0',
        'subrace:deep hollow|ash:lang:0',
        'background:ash scribe|ash:skill:0',
        'feat:skilled|tst:ash scribe|ash:skill:0',
        'feat:keen study|ash:asi4:skill:0',
      ]),
    );
    expect(docs[0]?.play.resources.map((r) => r.key)).toEqual([
      'spell:ember rod|ash:searing-bolt',
      'spell:added:smolder',
    ]);

    const report = await homebrewRepo.moveEntries({ from: ash, to: bone, entries: EVERY });
    expect(report.characters.sort()).toEqual(['grog', 'mira']);

    const after = await context();
    const moved = await stored(['grog', 'mira']);
    moved.forEach((doc, i) => {
      const sheet = deriveSheet(doc, after);
      expect(view(sheet), doc.name).toEqual(view(before[i] as DerivedSheet));
      holds(doc, sheet, after);
      expect(doc.play.resources.every((r) => r.used === 1)).toBe(true);
      expect(JSON.stringify(doc)).not.toMatch(/\|ash\b/i);
    });
    // Without the walk, the same builds lose what moved.
    docs.forEach((doc, i) => {
      expect(view(deriveSheet(doc, after))).not.toEqual(view(before[i] as DerivedSheet));
    });
  });

  it('derives the same once every entry it uses is renamed', async () => {
    const ash = await collection('Ash Book', ASH, ashContent());
    const { docs, ctx } = await built();
    const before = docs.map((d) => view(deriveSheet(d, ctx)));

    const names: Array<[string, string, string]> = [
      ['feat', 'Keen Study', 'Sharp Study'],
      ['background', 'Ash Scribe', 'Soot Clerk'],
      ['optionalfeature', 'Ash Guard', 'Soot Ward'],
      ['race', 'Kilnborn', 'Forgeborn'],
      ['subrace', 'Deep Hollow', 'Low Hollow'],
      ['item', 'Ember Rod', 'Glow Rod'],
      ['spell', 'Smolder', 'Flicker'],
      ['class', 'Hexer', 'Curser'],
      ['subclass', 'Way of Coals', 'Way of Cinders'],
    ];
    for (const [type, from, to] of names) {
      const result = await renameEntry(ash, type, from, to);
      expect(result.repointed?.changes, type).toEqual([
        { type, from: { name: from, source: ASH }, to: { name: to, source: ASH } },
      ]);
    }

    const after = await context();
    const renamed = await stored(['grog', 'mira']);
    renamed.forEach((doc, i) => {
      const sheet = deriveSheet(doc, after);
      expect(view(sheet), doc.name).toEqual(renamedView(before[i], names));
      holds(doc, sheet, after);
    });
  });

  it('keeps a subclass in another collection on its class once the class is renamed', async () => {
    const ash = await collection('Ash Book', ASH, ashContent());
    const bone = await collection('Bone Book', BONE);
    await built();
    await homebrewRepo.moveEntries({
      from: ash,
      to: bone,
      entries: EVERY.filter((e) => e.type === 'subclass'),
    });
    const [mira] = await stored(['mira']);
    const before = view(deriveSheet(mira as CharacterDoc, await context()));
    expect(before.features).toContain('Coal Heart');

    await renameEntry(ash, 'class', 'Hexer', 'Curser');

    expect((await content(bone)).subclass).toEqual([
      expect.objectContaining({ className: 'Curser', classSource: ASH, source: BONE }),
    ]);
    const [renamed] = await stored(['mira']);
    const after = await context();
    const sheet = deriveSheet(renamed as CharacterDoc, after);
    expect(view(sheet)).toEqual(renamedView(before, [['class', 'Hexer', 'Curser']]));
    holds(renamed as CharacterDoc, sheet, after);
  });
});
