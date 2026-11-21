// Try it on beyond numbers and lists: a weapon's attack, pool and spell, and
// the kinds held in a character's build (subrace, subclass, class), whose
// features go in front as their editor's writer writes them.
import { describe, expect, it } from 'vitest';
import { engineContextFor } from '@/data5e/engineAdapter';
import { type EntityRegistry, normalizeDataset } from '@/data5e/normalize';
import { RULE_SET_TYPE } from '@/engine/castGuidance';
import { type CharacterDoc, type EngineContext, newCharacterDoc } from '@/engine/types';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { editor as classEditor } from './editors/ClassEditor';
import { editor as subclassEditor } from './editors/SubclassEditor';
import type { EditorSpec, Json, WriteContext } from './editorTypes';
import {
  type Change,
  firstShown,
  onSheet,
  type Trying,
  tryOn,
  wearersFor,
  wearing,
} from './TryItOn';

/** A +1 longsword whose 3 charges cast Searing Bolt, with 1d6 fire on a hit. */
const blade = {
  name: 'Searing Blade',
  source: 'MyHomebrew',
  type: 'M',
  rarity: 'rare',
  reqAttune: true,
  baseItem: 'longsword|tst',
  weapon: true,
  weaponCategory: 'martial',
  dmg1: '1d8',
  dmgType: 'S',
  property: ['V'],
  bonusWeapon: '+1',
  extraDamage: [{ dmg: '1d6', dmgType: 'F' }],
  entries: ['A blade that sears.'],
  castGuidance: {
    v: 1,
    effects: [
      {
        kind: 'charges',
        charges: 3,
        regain: 'all',
        spells: [{ spell: 'Searing Bolt|TST', cost: 1 }],
      },
    ],
  },
};

function warrior(level: number, str = 16): CharacterDoc {
  const doc = newCharacterDoc('hild', 'Hild', '');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str, dex: 12, con: 14, int: 10, wis: 10, cha: 12 };
  doc.classes = [
    { ref: { name: 'Warrior', source: 'TST' }, levels: level, hp: Array(level).fill('avg') },
  ];
  return doc;
}

const changesOf = (t: ReturnType<typeof tryOn>): Change[] =>
  t.state === 'changed' ? t.changes : [];
const labels = (cs: readonly Change[]) => cs.map((c) => c.label);

/** The lookups with `entry` saved in the registry, as one the character already wears. */
function withSaved(ctx: EngineContext, entry: Json): EngineContext {
  return {
    ...ctx,
    get: (t, n, s) =>
      t === 'item' && n.toLowerCase() === String(entry.name).toLowerCase()
        ? entry
        : ctx.get(t, n, s),
    byType: (t) => (t === 'item' ? [entry, ...ctx.byType(t)] : ctx.byType(t)),
  };
}

describe('Try it on, a magic weapon', () => {
  it('lists its attack with its rider, its charge pool and the spell its charges cast', () => {
    const changes = changesOf(tryOn(makeTestContext(), warrior(5), 'item', blade));
    expect(changes).toContainEqual({
      label: 'Searing Blade',
      now: '+7 to hit, 1d8+4 slashing plus 1d6 fire',
    });
    expect(changes).toContainEqual({ label: 'Searing Blade charges', now: '3' });
    expect(changes).toContainEqual({ label: 'Spells', now: 'Searing Bolt' });
  });

  it('lists a changed attack and pool against the saved one', () => {
    const ctx = withSaved(makeTestContext(), blade);
    const held = wearing(warrior(5), 'item', blade) as CharacterDoc;
    const more = {
      ...blade,
      bonusWeapon: '+2',
      castGuidance: { v: 1, effects: [{ ...blade.castGuidance.effects[0], charges: 5 }] },
    };
    const changes = changesOf(tryOn(ctx, held, 'item', more));
    expect(changes).toContainEqual({
      label: 'Searing Blade',
      now: '+8 to hit, 1d8+5 slashing plus 1d6 fire',
      was: '+7 to hit, 1d8+4 slashing plus 1d6 fire',
    });
    expect(changes).toContainEqual({
      label: 'Searing Blade charges',
      now: '5',
      was: '3',
      way: 'up',
    });
    expect(labels(changes)).not.toContain('Spells');
  });

  it('still leads with its attack, pool and spell when it also sets Strength', () => {
    // Strength 19 moves saves, Athletics and every Strength attack too.
    const strong = {
      ...blade,
      castGuidance: {
        v: 1,
        effects: [
          ...blade.castGuidance.effects,
          { kind: 'abilityMin', ability: 'str', min: 19 },
          { kind: 'acBonus', amount: 1 },
        ],
      },
    };
    const doc = warrior(5, 8);
    doc.equipment = ['Longsword', 'Dagger', 'Shortbow'].map((name, i) => ({
      id: `w${i}`,
      ref: { name, source: 'TST' },
      qty: 1,
      equipped: true,
      attuned: false,
    }));
    const changes = changesOf(tryOn(makeTestContext(), doc, 'item', strong));
    expect(changes.length).toBeGreaterThan(8);
    const shown = labels(firstShown(changes));
    expect(shown).toHaveLength(8);
    expect(shown).toEqual(
      expect.arrayContaining([
        'Strength',
        'Armor Class',
        'Searing Blade',
        'Searing Blade charges',
        'Spells',
      ]),
    );
    // In the sheet's order still.
    expect(shown.indexOf('Strength')).toBeLessThan(shown.indexOf('Searing Blade'));
  });
});

describe('firstShown', () => {
  const row = (label: string, follows?: true): Change => ({
    label,
    now: '1',
    was: '0',
    ...(follows ? { follows } : {}),
  });
  it('keeps every row when they fit, and drops followers first when they do not', () => {
    expect(firstShown([row('a'), row('b', true)], 2).map((c) => c.label)).toEqual(['a', 'b']);
    const rows = [row('a'), row('s1', true), row('s2', true), row('b'), row('c')];
    expect(firstShown(rows, 4).map((c) => c.label)).toEqual(['a', 's1', 'b', 'c']);
    expect(firstShown(rows, 2).map((c) => c.label)).toEqual(['a', 'b']);
  });
});

/** Its darkvision and resistance, over its species'. */
const sky = {
  name: 'Dragonborn (Sky)',
  source: 'MyHomebrew',
  raceName: 'Dragonborn',
  raceSource: 'TST',
  darkvision: 60,
  resist: ['cold'],
  entries: [],
};

describe('Try it on, a subrace', () => {
  it('is worn as their species with this subrace, and shows its sense and resistance', () => {
    const on = wearing(warrior(3), 'subrace', sky);
    expect(on?.race).toEqual({ name: 'Dragonborn', source: 'TST' });
    expect(on?.subrace).toEqual({ name: 'Dragonborn (Sky)', source: 'MyHomebrew' });
    const changes = changesOf(tryOn(makeTestContext(), warrior(3), 'subrace', sky));
    expect(changes).toContainEqual({ label: 'Senses', now: 'darkvision 60 ft.', was: 'none' });
    expect(changes).toContainEqual({ label: 'Resistances', now: 'cold', was: 'none' });
  });

  it('waits for its species to be picked', () => {
    const { raceName: _, raceSource: __, ...none } = sky;
    expect(wearersFor(makeTestContext(), 'subrace', none, [])).toEqual({
      wearers: [],
      none: 'Pick the species it belongs to, and it can be tried on.',
    });
  });
});

const GUARDING = {
  name: 'Path of Guarding',
  shortName: 'Guarding',
  source: 'TST',
  className: 'Warrior',
  classSource: 'TST',
  subclassFeatures: ['Guarded Stance|Warrior|TST|Guarding|TST|3'],
};
const GUARDED = {
  name: 'Guarded Stance',
  source: 'TST',
  className: 'Warrior',
  classSource: 'TST',
  subclassShortName: 'Guarding',
  subclassSource: 'TST',
  level: 3,
  entries: ['You keep your guard up.'],
  castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: 1 }] },
};

/** The test world's classes as a real registry, with Path of Guarding (+1 AC at level 3). */
function world(): EntityRegistry {
  const ctx = makeTestContext();
  const registry = normalizeDataset(
    new Map<string, unknown>([
      ['races.json', { race: ctx.byType('race'), subrace: ctx.byType('subrace') }],
      [
        'class/class-test.json',
        {
          class: ctx.byType('class'),
          classFeature: ctx.byType('classFeature'),
          subclass: [...ctx.byType('subclass'), GUARDING],
          subclassFeature: [...ctx.byType('subclassFeature'), GUARDED],
        },
      ],
    ]),
  );
  registry.setRuleSets(ctx.byType(RULE_SET_TYPE) as never);
  return registry;
}

/** What the Workshop hands Try it on for a subclass or class draft: what Save writes. */
function written(spec: EditorSpec, at: Omit<WriteContext, 'source' | 'mode'>): Trying {
  const own = spec.write?.({ source: 'MyHomebrew', mode: 'changes', ...at });
  if (own === undefined) throw new Error('no writer');
  return {
    entry: own.entry,
    owned: own.owned,
    ...(at.original !== undefined ? { original: at.original } : {}),
  };
}

/** Try `trying` on `doc` as the Workshop does: its entries in front, read as saved. */
function tryWritten(
  registry: EntityRegistry,
  doc: CharacterDoc,
  type: string,
  trying: Trying,
  level?: number,
) {
  const [main, ...also] = onSheet(registry, type, trying);
  return tryOn(engineContextFor(registry), doc, type, main?.entry ?? {}, { also, level });
}

/** A copy of Path of Guarding opened in the subclass editor, as the Workshop opens one. */
function guardingCopy(registry: EntityRegistry, edit: (draft: Json) => void = () => {}): Trying {
  const original = registry.get('subclass', 'Path of Guarding', 'TST') as Json;
  const draft = subclassEditor.open?.(structuredClone(original), { original, registry }) ?? {};
  draft.name = 'Path of the Wall';
  edit(draft);
  return written(subclassEditor, { original, copied: original, draft, registry });
}

/** A level `level` warrior on Path of Guarding. */
function guard(level: number): CharacterDoc {
  const doc = warrior(level);
  const row = doc.classes[0];
  if (row !== undefined) row.subclass = { name: 'Path of Guarding', source: 'TST' };
  return doc;
}

describe('Try it on, a subclass', () => {
  it('is tried on a sample of its class at its last feature level, and its +1 AC shows', () => {
    const registry = world();
    const sub = registry.get('subclass', 'Path of Guarding', 'TST') as Json;
    const [sample, ...rest] = wearersFor(engineContextFor(registry), 'subclass', sub, []).wearers;
    expect(rest).toEqual([]);
    expect(sample?.label).toBe('A level 3 warrior');
    expect(sample?.note).toMatch(/At level 3, where its last feature/);
    expect(sample?.doc.classes[0]?.subclass).toBeUndefined();
    const tried = tryWritten(registry, sample?.doc ?? warrior(3), 'subclass', { entry: sub });
    expect(changesOf(tried)).toContainEqual(
      expect.objectContaining({ label: 'Armor Class', way: 'up' }),
    );
    const ac = changesOf(tried).find((c) => c.label === 'Armor Class');
    expect(Number(ac?.now) - Number(ac?.was)).toBe(1);
  });

  it('offers the characters with levels in its class, and takes the place of their subclass', () => {
    const registry = world();
    const sub = registry.get('subclass', 'Path of Guarding', 'TST') as Json;
    const tests = warrior(5);
    const row = tests.classes[0];
    if (row !== undefined) row.subclass = { name: 'Path of Tests', source: 'TST' };
    const mage = newCharacterDoc('mage', 'Mira', '');
    mage.classes = [{ ref: { name: 'Mage', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
    const { wearers } = wearersFor(engineContextFor(registry), 'subclass', sub, [tests, mage]);
    expect(wearers.map((w) => w.key)).toEqual(['subclass', 'hild']);
    expect(wearing(tests, 'subclass', sub)?.classes[0]?.subclass).toEqual({
      name: 'Path of Guarding',
      source: 'TST',
    });
    expect(wearing(mage, 'subclass', sub)).toBeUndefined();
    expect(changesOf(tryWritten(registry, tests, 'subclass', { entry: sub }))).toContainEqual(
      expect.objectContaining({ label: 'Armor Class', way: 'up' }),
    );
  });

  it('moves nothing for a copy left as it is, worn in place of its original', () => {
    const registry = world();
    const copy = guardingCopy(registry);
    // Saved as changes: the copy names its original, and owns no feature.
    expect(copy.entry._copy).toMatchObject({ name: 'Path of Guarding', source: 'TST' });
    expect(copy.owned).toEqual([]);
    expect(tryWritten(registry, guard(3), 'subclass', copy)).toMatchObject({ state: 'none' });
  });

  it('shows a feature the player changed, read against the one it copies', () => {
    const registry = world();
    const copy = guardingCopy(registry, (draft) => {
      const edits = draft._features as { changed: Record<string, Json> };
      edits.changed['Guarded Stance|Warrior|TST|Guarding|TST|3'] = {
        ...GUARDED,
        castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: 2 }] },
      };
    });
    expect(copy.owned?.[0]?._copy).toMatchObject({ name: 'Guarded Stance', level: 3 });
    const ac = changesOf(tryWritten(registry, guard(3), 'subclass', copy)).find(
      (c) => c.label === 'Armor Class',
    );
    expect(ac?.way).toBe('up');
    expect(Number(ac?.now) - Number(ac?.was)).toBe(1);
  });

  it('reads a changed feature against the one it copies, and its +1 AC still counts', () => {
    const registry = world();
    const copy = guardingCopy(registry, (draft) => {
      const edits = draft._features as { changed: Record<string, Json> };
      edits.changed['Guarded Stance|Warrior|TST|Guarding|TST|3'] = {
        ...GUARDED,
        entries: ['You keep your guard up, always.'],
      };
    });
    // Saved as its changes alone: its text is read against the original it copies.
    const [sub, feature] = onSheet(registry, 'subclass', copy);
    expect(sub?.entry).not.toHaveProperty('_copy');
    expect(sub?.entry.subclassFeatures).toEqual([
      'Guarded Stance|Warrior|TST|Guarding|MyHomebrew|3',
    ]);
    expect(feature?.type).toBe('subclassFeature');
    expect(feature?.entry).not.toHaveProperty('_copy');
    expect(feature?.entry.entries).toEqual(['You keep your guard up, always.']);
    expect(tryWritten(registry, guard(3), 'subclass', copy)).toMatchObject({ state: 'none' });
  });

  it('shows a feature added in the editor, which only Save writes as an entry of its own', () => {
    const registry = world();
    const draft: Json = {
      ...subclassEditor.blank(),
      name: 'Path of Thorns',
      className: 'Warrior',
      classSource: 'TST',
    };
    (draft._features as { added: Json[] }).added.push({
      name: 'Thorned Hide',
      level: 3,
      entries: ['Thorns grow from your skin.'],
      castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: 1 }] },
    });
    const trying = written(subclassEditor, { draft, registry });
    expect(trying.owned).toHaveLength(1);
    const ctx = engineContextFor(registry);
    const sample = wearersFor(ctx, 'subclass', trying.entry, []).wearers[0];
    expect(sample?.label).toBe('A level 3 warrior');
    const doc = sample?.doc ?? warrior(3);
    // The draft alone, without what Save writes, has no feature to show.
    const alone = tryWritten(registry, doc, 'subclass', {
      entry: { ...draft, source: 'MyHomebrew' },
    });
    expect(labels(changesOf(alone))).not.toContain('Armor Class');
    const ac = changesOf(tryWritten(registry, doc, 'subclass', trying)).find(
      (c) => c.label === 'Armor Class',
    );
    expect(ac?.way).toBe('up');
    expect(Number(ac?.now) - Number(ac?.was)).toBe(1);
  });

  it('waits for its class to be picked, and says when no one has it', () => {
    expect(wearersFor(makeTestContext(), 'subclass', { name: 'X' }, []).none).toBe(
      'Pick the class it is for, and it can be tried on.',
    );
    expect(
      wearersFor(makeTestContext(), 'subclass', { name: 'X', className: 'Nobody' }, []).none,
    ).toMatch(/Nobody is not in your data/);
  });
});

describe('Try it on, a class', () => {
  it('takes their place at the same total level, and a sample takes it at its last feature', () => {
    const registry = world();
    const mage = newCharacterDoc('mage', 'Mira', '');
    mage.classes = [
      { ref: { name: 'Mage', source: 'TST' }, levels: 3, hp: [6, 4, 'avg'] },
      { ref: { name: 'Sneak', source: 'TST' }, levels: 2, hp: ['avg', 'avg'] },
    ];
    const cls = registry.get('class', 'Warrior', 'TST') as Json;
    expect(wearing(mage, 'class', cls)?.classes).toEqual([
      { ref: { name: 'Warrior', source: 'TST' }, levels: 5, hp: Array(5).fill('avg') },
    ]);
    // One who has it keeps their levels.
    const own = warrior(4);
    expect(wearing(own, 'class', cls)?.classes).toEqual(own.classes);
    const { wearers } = wearersFor(engineContextFor(registry), 'class', cls, [mage]);
    expect(wearers.map((w) => [w.label, w.level])).toEqual([
      ['A level 5 warrior', 5],
      ['Mira', undefined],
    ]);
    expect(wearers[0]?.doc.classes).toEqual([]);
    const tried = tryWritten(registry, mage, 'class', { entry: cls });
    expect(labels(changesOf(tried))).toEqual(
      expect.arrayContaining(['Hit point maximum', 'Armor']),
    );
  });

  it('shows a feature added in the editor on a sample of the class', () => {
    const registry = world();
    const draft: Json = { ...classEditor.blank(), name: 'Guardian' };
    (draft._features as { added: Json[] }).added.push({
      name: 'Steady Guard',
      level: 2,
      entries: ['You stand firm.'],
      castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: 2 }] },
    });
    const trying = written(classEditor, { draft, registry });
    const { wearers } = wearersFor(engineContextFor(registry), 'class', trying.entry, []);
    const sample = wearers[0];
    // A new class starts with Ability Score Improvements, the last at level 19.
    expect(sample?.level).toBe(19);
    expect(sample?.label).toBe('A level 19 guardian');
    const doc = sample?.doc ?? warrior(1);
    const ac = (t: Trying) =>
      changesOf(tryWritten(registry, doc, 'class', t, sample?.level)).find(
        (c) => c.label === 'Armor Class',
      );
    // Dexterity 14 and no armor: 12, and 14 with the feature.
    expect(ac(trying)).toEqual({ label: 'Armor Class', now: '14', was: '12', way: 'up' });
    expect(ac({ ...trying, owned: [] })).toBeUndefined();
  });
});
