// @vitest-environment jsdom
// The class editor: what Save writes for a class and its features, that the
// Workshop reopens it as the player left it, its pools and its spell columns
// (Homebrew Workshop phase 9).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { type EntityRegistry, mergeHomebrew, normalizeDataset } from '@/data5e/normalize';
import { readStored } from '../copyWriter';
import { EDITORS, type Json } from '../editorTypes';
import {
  asByLevel,
  byLevelValues,
  editor,
  editsOf,
  type FeatureEdits,
  featureTree,
  openClass,
  setFrom,
  summarize,
  tableGroupsFor,
  writeClass,
} from './ClassEditor';

afterEach(cleanup);

const ref = (name: string, level: number, cls = 'Monk', source = 'XPHB') =>
  `${name}|${cls}|${source}|${level}${source === 'XPHB' ? '' : `|${source}`}`;
const mine = (name: string, level: number) => `${name}|Lantern|MyHomebrew|${level}|MyHomebrew`;
const feature = (name: string, level: number, entries: unknown[], extra: Json = {}): Json => ({
  name,
  source: 'XPHB',
  className: 'Monk',
  classSource: 'XPHB',
  level,
  entries,
  ...extra,
});
const refBlock = (r: string) => ({ type: 'refClassFeature', classFeature: r });
const FOCUS_TEXT = [
  'You have focus.',
  {
    type: 'entries',
    name: 'Focus Actions',
    entries: [refBlock(ref('Flurry of Blows', 2)), refBlock(ref('Patient Defense', 2))],
  },
];
const MONK: Json = {
  name: 'Monk',
  source: 'XPHB',
  hd: { number: 1, faces: 8 },
  proficiency: ['str', 'dex'],
  classTableGroups: [
    {
      colLabels: ['Martial Arts', 'Focus Points'],
      rows: Array.from({ length: 20 }, (_, i) => [
        { type: 'dice', toRoll: [{ number: 1, faces: i < 4 ? 6 : 8 }] },
        i < 1 ? 0 : i + 1,
      ]),
    },
  ],
  classFeatures: [
    ref('Martial Arts', 1),
    ref("Monk's Focus", 2),
    { classFeature: ref('Monk Subclass', 3), gainSubclassFeature: true },
    ref('Ability Score Improvement', 4),
    ref('Ability Score Improvement', 8),
  ],
};

/** A small Monk book: Monk's Focus holds Flurry of Blows and Patient Defense in its text. */
function book(): { registry: EntityRegistry; cls: Json } {
  const registry = normalizeDataset(
    new Map([
      [
        'class/class-monk.json',
        {
          class: [MONK],
          classFeature: [
            feature('Martial Arts', 1, ['Strike with your fists.']),
            feature("Monk's Focus", 2, FOCUS_TEXT),
            feature('Flurry of Blows', 2, ['Two strikes.']),
            feature('Patient Defense', 2, ['Disengage.']),
            feature('Monk Subclass', 3, ['Pick a subclass.']),
            feature('Ability Score Improvement', 4, ['Plus two.']),
            feature('Ability Score Improvement', 8, ['Plus two.']),
          ],
        },
      ],
    ]),
  );
  return { registry, cls: registry.get('class', 'Monk', 'XPHB') as Json };
}

const nodeOf = (registry: EntityRegistry, cls: Json, name: string, level?: number) => {
  const n = featureTree(cls, registry).find(
    (f) => f.entity?.name === name && (level === undefined || f.level === level),
  );
  if (n === undefined) throw new Error(`no ${name}`);
  return n;
};

/** A copy of the Monk with these edits, as Save writes it. */
function save(
  registry: EntityRegistry,
  cls: Json,
  edits: Partial<FeatureEdits>,
  mode: 'changes' | 'full' = 'changes',
  patch: Json = {},
) {
  const draft = openClass(structuredClone(cls), { original: cls, registry });
  Object.assign(draft, { name: 'Lantern', ...patch });
  draft._features = { ...editsOf(draft), ...edits };
  return writeClass({ original: cls, copied: cls, draft, source: 'MyHomebrew', mode, registry });
}

/** The registry with the written file loaded, as the app loads homebrew. */
function loaded(registry: EntityRegistry, written: ReturnType<typeof save>) {
  mergeHomebrew(
    registry,
    new Map([
      [
        'mine',
        {
          _meta: { sources: [{ json: 'MyHomebrew' }] },
          class: [structuredClone(written.entry)],
          classFeature: structuredClone(written.owned),
        },
      ],
    ]),
  );
  return registry.get('class', 'Lantern', 'MyHomebrew') as Json;
}

/** A feature as the sheet finds it by ref: name, class, book and level. */
const find = (registry: EntityRegistry, r: string) => {
  const [name, cls, source, level] = r.split('|');
  return registry
    .byType('classFeature')
    .find(
      (f) =>
        f.name === name &&
        f.className === cls &&
        f.classSource === (source || 'PHB') &&
        String(f.level) === level,
    ) as Json | undefined;
};

describe('the Workshop', () => {
  it('finds this editor for classes', async () => {
    const load = EDITORS.get('class');
    expect(load).toBeDefined();
    expect((await load?.())?.editor).toBe(editor);
  });
});

describe('featureTree', () => {
  it('lists each feature once, with those its text holds under it', () => {
    const { registry, cls } = book();
    const tree = featureTree(cls, registry);
    expect(tree.map((n) => [n.ref, n.parent])).toEqual([
      [ref('Martial Arts', 1), undefined],
      [ref("Monk's Focus", 2), undefined],
      [ref('Flurry of Blows', 2), ref("Monk's Focus", 2)],
      [ref('Patient Defense', 2), ref("Monk's Focus", 2)],
      [ref('Monk Subclass', 3), undefined],
      [ref('Ability Score Improvement', 4), undefined],
      [ref('Ability Score Improvement', 8), undefined],
    ]);
    // A block only refs filled goes with them: it is shown as the features.
    expect(tree[1]?.base.entries).toEqual(['You have focus.']);
    expect(tree[6]?.entity?.level).toBe(8);
  });
});

describe('writeClass', () => {
  it('writes an unchanged copy as its name and what it copies, and no feature', () => {
    const { registry, cls } = book();
    const { entry, owned } = save(registry, cls, {});
    expect(owned).toEqual([]);
    expect(entry).toMatchObject({
      name: 'Lantern',
      source: 'MyHomebrew',
      _copy: { name: 'Monk', source: 'XPHB' },
      castGuidance: { v: 1, basedOn: 'Monk|XPHB' },
    });
    const copy = loaded(registry, { entry, owned });
    expect(copy.classFeatures).toEqual(cls.classFeatures);
    expect(copy.classTableGroups).toEqual(cls.classTableGroups);
  });

  it('keeps a changed held feature in its holder, which points at it', () => {
    const { registry, cls } = book();
    const flurry = nodeOf(registry, cls, 'Flurry of Blows');
    const written = save(registry, cls, {
      changed: { [flurry.ref]: { ...flurry.base, name: 'Lantern Flurry' } },
    });
    // The holder is listed, not what it holds.
    expect(written.entry.classFeatures).toEqual([
      ref('Martial Arts', 1),
      mine("Monk's Focus", 2),
      { classFeature: ref('Monk Subclass', 3), gainSubclassFeature: true },
      ref('Ability Score Improvement', 4),
      ref('Ability Score Improvement', 8),
    ]);
    expect(written.owned.map((f) => f.name)).toEqual(["Monk's Focus", 'Lantern Flurry']);
    const copy = loaded(registry, written);
    const focus = find(registry, (copy.classFeatures as string[])[1] as string);
    // In the same place in the text, the patience one still the book's.
    expect(focus?.entries).toEqual([
      'You have focus.',
      {
        type: 'entries',
        name: 'Focus Actions',
        entries: [refBlock(mine('Lantern Flurry', 2)), refBlock(ref('Patient Defense', 2))],
      },
    ]);
    expect(find(registry, mine('Lantern Flurry', 2))?.entries).toEqual(['Two strikes.']);
  });

  it('takes a removed held feature out of its holder', () => {
    const { registry, cls } = book();
    const written = save(registry, cls, { removed: [ref('Patient Defense', 2)] });
    const copy = loaded(registry, written);
    const focus = find(registry, (copy.classFeatures as string[])[1] as string);
    expect(focus?.entries).toEqual([
      'You have focus.',
      { type: 'entries', name: 'Focus Actions', entries: [refBlock(ref('Flurry of Blows', 2))] },
    ]);
  });

  it('puts what a rewritten holder holds after its new text', () => {
    const { registry, cls } = book();
    const focus = nodeOf(registry, cls, "Monk's Focus");
    const written = save(registry, cls, {
      changed: { [focus.ref]: { ...focus.base, entries: ['You have a lantern.'] } },
    });
    const copy = loaded(registry, written);
    expect(find(registry, (copy.classFeatures as string[])[1] as string)?.entries).toEqual([
      'You have a lantern.',
      refBlock(ref('Flurry of Blows', 2)),
      refBlock(ref('Patient Defense', 2)),
    ]);
  });

  it('lists what a holder held on the class when the holder alone is taken out', () => {
    const { registry, cls } = book();
    const written = save(registry, cls, { removed: [ref("Monk's Focus", 2)] });
    expect(written.entry.classFeatures).toEqual([
      ref('Martial Arts', 1),
      ref('Flurry of Blows', 2),
      ref('Patient Defense', 2),
      { classFeature: ref('Monk Subclass', 3), gainSubclassFeature: true },
      ref('Ability Score Improvement', 4),
      ref('Ability Score Improvement', 8),
    ]);
  });

  it('writes a feature whole when another shares its name and book, at its own level', () => {
    const { registry, cls } = book();
    const asi = nodeOf(registry, cls, 'Ability Score Improvement', 8);
    const written = save(registry, cls, {
      changed: { [asi.ref]: { ...asi.base, entries: ['Plus two, or a feat.'] } },
    });
    const [f] = written.owned;
    expect(f?._copy).toBeUndefined();
    expect(f).toMatchObject({
      name: 'Ability Score Improvement',
      level: 8,
      className: 'Lantern',
      classSource: 'MyHomebrew',
      entries: ['Plus two, or a feat.'],
      castGuidance: { basedOn: 'Ability Score Improvement|XPHB' },
    });
    expect((written.entry.classFeatures as unknown[]).at(-1)).toBe(
      mine('Ability Score Improvement', 8),
    );
  });

  it('saves a lone feature as changes, with where its original sits', () => {
    const { registry, cls } = book();
    const arts = nodeOf(registry, cls, 'Martial Arts');
    const [f] = save(registry, cls, {
      changed: { [arts.ref]: { ...arts.base, entries: ['Strike with a lantern.'] } },
    }).owned;
    expect(f).toMatchObject({
      name: 'Martial Arts',
      source: 'MyHomebrew',
      className: 'Lantern',
      level: 1,
      _copy: { name: 'Martial Arts', source: 'XPHB', className: 'Monk', level: 1 },
    });
    expect(f?.entries).toBeUndefined();
  });

  it('lists a new feature after the last of its level, a subclass level as one', () => {
    const { registry, cls } = book();
    const written = save(registry, cls, {
      added: [
        { name: 'Watchful Step', level: 2, entries: ['Step aside.'] },
        { name: 'Lantern Order', level: 6, gainSubclassFeature: true, entries: [] },
      ],
    });
    const list = written.entry.classFeatures as unknown[];
    expect(list.indexOf(mine('Watchful Step', 2))).toBe(2);
    expect(list.at(-2)).toEqual({
      classFeature: mine('Lantern Order', 6),
      gainSubclassFeature: true,
    });
    expect(written.owned.find((f) => f.name === 'Lantern Order')).not.toHaveProperty(
      'gainSubclassFeature',
    );
  });

  it('finds a renamed feature by its name as stored, without the spaces around it', () => {
    const { registry, cls } = book();
    const arts = nodeOf(registry, cls, 'Martial Arts');
    const flurry = nodeOf(registry, cls, 'Flurry of Blows');
    const written = save(registry, cls, {
      changed: {
        [arts.ref]: { ...arts.base, name: 'Lantern Arts ' },
        [flurry.ref]: { ...flurry.base, name: ' Lantern Flurry' },
      },
    });
    expect((written.entry.classFeatures as unknown[])[0]).toBe(mine('Lantern Arts', 1));
    loaded(registry, written);
    expect(find(registry, mine('Lantern Arts', 1))?.name).toBe('Lantern Arts');
    const focus = find(registry, mine("Monk's Focus", 2));
    expect(JSON.stringify(focus?.entries)).toContain(mine('Lantern Flurry', 2));
  });

  it('follows a held feature under entry, as the sheet does', () => {
    const sage = (name: string, level: number) => ref(name, level, 'Sage');
    const registry = normalizeDataset(
      new Map([
        [
          'class/class-sage.json',
          {
            class: [{ name: 'Sage', source: 'XPHB', classFeatures: [sage('Lore', 1)] }],
            classFeature: [
              {
                ...feature('Lore', 1, [
                  'You know things.',
                  { type: 'item', name: 'Recall', entry: refBlock(sage('Recall', 1)) },
                ]),
                className: 'Sage',
              },
              { ...feature('Recall', 1, ['Remember.']), className: 'Sage' },
            ],
          },
        ],
      ]),
    );
    const cls = registry.get('class', 'Sage', 'XPHB') as Json;
    expect(featureTree(cls, registry).map((n) => n.ref)).toEqual([
      sage('Lore', 1),
      sage('Recall', 1),
    ]);
    const lore = nodeOf(registry, cls, 'Lore');
    expect(lore.base.entries).toEqual(['You know things.']);
    const written = save(registry, cls, { removed: [sage('Recall', 1)] });
    expect(written.owned.map((f) => f.name)).toEqual(['Lore']);
    expect(readStored(written.owned[0] as Json, lore.entity as Json).entry.entries).toEqual([
      'You know things.',
    ]);
  });

  it('writes every feature in full for a full copy, held ones still held', () => {
    const { registry, cls } = book();
    const written = save(registry, cls, {}, 'full');
    expect(written.entry._copy).toBeUndefined();
    expect(written.owned.every((f) => f._copy === undefined)).toBe(true);
    expect(written.owned).toHaveLength(7);
    expect(written.entry.classFeatures).toHaveLength(5);
    const copy = loaded(registry, written);
    expect(find(registry, (copy.classFeatures as string[])[1] as string)?.entries).toEqual([
      'You have focus.',
      {
        type: 'entries',
        name: 'Focus Actions',
        entries: [refBlock(mine('Flurry of Blows', 2)), refBlock(mine('Patient Defense', 2))],
      },
    ]);
  });
});

describe('openClass', () => {
  const edits = (registry: EntityRegistry, cls: Json): FeatureEdits => {
    const flurry = nodeOf(registry, cls, 'Flurry of Blows');
    return {
      changed: { [flurry.ref]: { ...flurry.base, name: 'Lantern Flurry', entries: ['Three.'] } },
      removed: [ref('Ability Score Improvement', 4)],
      added: [{ name: 'Watchful Step', level: 2, entries: ['Step aside.'] }],
    };
  };

  for (const mode of ['changes', 'full'] as const) {
    it(`reopens a ${mode} copy with the edits it was saved with, from the player's file`, () => {
      const { registry, cls } = book();
      const want = edits(registry, cls);
      const written = save(registry, cls, want, mode);
      const file = { class: [written.entry], classFeature: written.owned };
      // A registry without the player's file, as when it is turned off.
      const off = book();
      const stored = structuredClone(written.entry);
      const entry = mode === 'full' ? stored : readStored(stored, off.cls).entry;
      const back = editsOf(openClass(entry, { original: off.cls, registry: off.registry, file }));
      expect(back.removed).toEqual(want.removed);
      expect(back.added).toEqual(want.added);
      expect(Object.keys(back.changed)).toEqual(Object.keys(want.changed));
      expect(Object.values(back.changed)[0]).toMatchObject({
        name: 'Lantern Flurry',
        entries: ['Three.'],
      });
    });
  }

  it("reopens a class started from one of the player's own with the edits it was saved with", () => {
    const { registry, cls } = book();
    const lantern = loaded(registry, save(registry, cls, edits(registry, cls)));
    const theirs = nodeOf(registry, lantern, 'Lantern Flurry');
    const draft = openClass(structuredClone(lantern), { original: lantern, registry });
    Object.assign(draft, { name: 'Lantern B' });
    draft._features = {
      ...editsOf(draft),
      changed: { [theirs.ref]: { ...theirs.base, entries: ['Four.'] } },
    };
    const b = writeClass({
      original: lantern,
      copied: lantern,
      draft,
      source: 'MyHomebrew',
      mode: 'changes',
      registry,
    });
    // Written whole: a copy of the player's own feature would share its name and book.
    const flurry = b.owned.find((f) => f.name === 'Lantern Flurry');
    expect(flurry?._copy).toBeUndefined();
    expect(flurry?.castGuidance).toMatchObject({ basedOn: 'Flurry of Blows|XPHB' });
    const file = { class: [b.entry], classFeature: b.owned };
    const { entry } = readStored(structuredClone(b.entry), lantern);
    const back = editsOf(openClass(entry, { original: lantern, registry, file }));
    expect(back).toMatchObject({ removed: [], added: [] });
    expect(Object.keys(back.changed)).toEqual([theirs.ref]);
  });

  it('keeps what a feature holds in it when a full copy opens without its original', () => {
    const { registry, cls } = book();
    const written = save(registry, cls, edits(registry, cls), 'full');
    const file = { class: [written.entry], classFeature: written.owned };
    const draft = openClass(structuredClone(written.entry), { registry: book().registry, file });
    const again = () =>
      writeClass({ draft, source: 'MyHomebrew', mode: 'full', registry: book().registry });
    const first = again();
    const list = first.entry.classFeatures as unknown[];
    expect(list).not.toContain(mine('Lantern Flurry', 2));
    expect(list).not.toContain(mine('Patient Defense', 2));
    const focus = first.owned.find((f) => f.name === "Monk's Focus");
    expect(focus?.entries).toEqual(written.owned.find((f) => f.name === "Monk's Focus")?.entries);
    // Taken out with what held it gone, a held one is listed on the class.
    const ed = editsOf(draft);
    draft._features = { ...ed, added: ed.added.filter((a) => a.name !== "Monk's Focus") };
    const second = again().entry.classFeatures as unknown[];
    expect(second).toContain(mine('Lantern Flurry', 2));
    expect(second).toContain(mine('Patient Defense', 2));
  });

  it('does not count a holder written only to point at a changed feature as changed', () => {
    const { registry, cls } = book();
    const written = save(registry, cls, edits(registry, cls));
    const file = { class: [written.entry], classFeature: written.owned };
    const { entry } = readStored(structuredClone(written.entry), cls);
    const back = editsOf(openClass(entry, { original: cls, registry, file }));
    expect(back.changed[ref("Monk's Focus", 2)]).toBeUndefined();
  });
});

describe('pools', () => {
  it('reads and writes a level table as the class table does', () => {
    const values = byLevelValues({ '1': 2, '5': 3, '9': 4 });
    expect(values.slice(0, 10)).toEqual([2, 2, 2, 2, 3, 3, 3, 3, 4, 4]);
    expect(asByLevel(values)).toEqual({ '1': 2, '5': 3, '9': 4 });
    expect(asByLevel(byLevelValues({}))).toEqual({ '1': 0 });
    // Set at 3: the levels after it with the same number follow, up to the next change.
    expect(asByLevel(setFrom(values, 3, 5))).toEqual({ '1': 2, '3': 5, '5': 3, '9': 4 });
  });

  it('adds the pools as a column of the class table, and reopens without it', () => {
    const { registry, cls } = book();
    const vigil = {
      kind: 'resource',
      key: 'vigil',
      label: 'Vigil',
      max: { byLevel: { '1': 2, '5': 3 } },
      reset: 'long',
    };
    const written = save(registry, cls, {}, 'changes', {
      castGuidance: { v: 1, effects: [vigil] },
    });
    const groups = readStored(structuredClone(written.entry), cls).entry.classTableGroups;
    expect((groups as Json[]).at(-1)).toEqual({
      colLabels: ['Vigil'],
      rows: Array.from({ length: 20 }, (_, i) => [i < 4 ? 2 : 3]),
    });
    const { entry } = readStored(structuredClone(written.entry), cls);
    expect(openClass(entry, { original: cls, registry }).classTableGroups).toEqual(
      cls.classTableGroups,
    );
  });
});

describe('tableGroupsFor', () => {
  it('adds spell counts and slots for a class new to spells, and takes them out again', () => {
    const counts = Array.from({ length: 20 }, (_, i) => i + 2);
    const caster = {
      ...MONK,
      casterProgression: '1/2',
      spellcastingAbility: 'wis',
      preparedSpellsProgression: counts,
    };
    const groups = tableGroupsFor(caster, MONK) as Json[];
    expect(groups[0]).toEqual({
      colLabels: ['Prepared Spells'],
      rows: counts.map((n) => [n]),
    });
    const slots = groups.find((g) => Array.isArray(g.rowsSpellProgression));
    expect(slots?.colLabels).toEqual(['1st', '2nd', '3rd', '4th', '5th']);
    // A half caster's first slots at level 2, as the sheet counts them.
    expect((slots?.rowsSpellProgression as number[][]).slice(0, 2)).toEqual([
      [0, 0, 0, 0, 0],
      [2, 0, 0, 0, 0],
    ]);
    expect(tableGroupsFor({ ...caster, casterProgression: undefined }, caster)).toEqual(
      MONK.classTableGroups,
    );
  });

  it('takes out a spell count column the class no longer has', () => {
    const known = {
      ...MONK,
      casterProgression: 'full',
      spellcastingAbility: 'wis',
      spellsKnownProgression: Array.from({ length: 20 }, () => 4),
      classTableGroups: [
        { colLabels: ['Spells Known'], rows: Array.from({ length: 20 }, () => [4]) },
      ],
    };
    const { spellsKnownProgression: _, ...prepared } = {
      ...known,
      preparedSpellsProgression: Array.from({ length: 20 }, () => 5),
    };
    const labels = (tableGroupsFor(prepared, known) as Json[]).flatMap((g) => g.colLabels);
    expect(labels).toContain('Prepared Spells');
    expect(labels).not.toContain('Spells Known');
  });

  it('replaces a slot table only shown with the one the sheet reads', () => {
    const ordinals = ['1st', '2nd', '3rd', '4th', '5th'];
    const shown = {
      ...MONK,
      casterProgression: '1/2',
      spellcastingAbility: 'wis',
      classTableGroups: [
        {
          title: 'Spell Slots per Spell Level',
          colLabels: ordinals.map((o) => `{@filter ${o}|spells|level=1}`),
          rows: Array.from({ length: 20 }, () => [1, 0, 0, 0, 0]),
        },
      ],
    };
    const groups = tableGroupsFor({ ...shown, casterProgression: 'full' }, shown) as Json[];
    expect(groups).toHaveLength(1);
    expect(groups[0]?.rowsSpellProgression).toBeDefined();
  });

  it('leaves the table as the book has it when the spellcasting did not change', () => {
    expect(tableGroupsFor(structuredClone(MONK), MONK)).toEqual(MONK.classTableGroups);
  });
});

describe('summarize and check', () => {
  it('counts the features the way the board does', () => {
    const { registry, cls } = book();
    const draft = openClass(structuredClone(cls), { original: cls, registry });
    expect(summarize(draft, cls, registry)).toBe(
      'No changes from Monk yet. You can save it as it is.',
    );
    draft._features = edits3(registry, cls);
    expect(summarize({ ...draft, hd: { number: 1, faces: 10 } }, cls, registry)).toBe(
      '1 changed, 1 new, 1 removed, 5 kept features, and 1 change to the class. Saved as changes from Monk.',
    );
  });

  it('asks for features the sheet can tell apart, named pools and a casting ability', () => {
    const check = editor.check ?? (() => undefined);
    const added = (...names: string[]) => ({
      name: 'Lantern',
      _features: { changed: {}, removed: [], added: names.map((name) => ({ name, level: 3 })) },
    });
    expect(check(added('Reach'))).toBeUndefined();
    expect(check(added(''))).toBe('Every feature needs a name.');
    expect(check(added('A|B'))).toBe('A feature name cannot have | in it.');
    expect(check(added('Reach', 'reach'))).toBe('Two features at level 3 are called reach.');
    expect(check({ name: 'Lantern', casterProgression: 'full' })).toBe(
      'Pick the ability it casts its spells with.',
    );
    const pool = (label: string) => ({ kind: 'resource', key: label, label, max: { byLevel: {} } });
    expect(check({ name: 'L', castGuidance: { v: 1, effects: [pool('A'), pool('a')] } })).toBe(
      'Two pools have the same name.',
    );
  });

  it('asks for names Save would write twice, a book feature it has to write among them', () => {
    const check = editor.check ?? (() => undefined);
    const { registry, cls } = book();
    const flurry = nodeOf(registry, cls, 'Flurry of Blows');
    const draft = openClass(structuredClone(cls), { original: cls, registry });
    draft.name = 'Lantern';
    // Changing what Monk's Focus holds writes Monk's Focus too.
    draft._features = {
      ...editsOf(draft),
      changed: { [flurry.ref]: { ...flurry.base, entries: ['Three.'] } },
      added: [{ name: "Monk's Focus", level: 2, entries: [] }],
    };
    const at = { original: cls, copied: cls, source: 'MyHomebrew', registry };
    expect(check(draft)).toBeUndefined();
    expect(check(draft, { ...at, mode: 'changes' })).toBe(
      "Two features at level 2 are called Monk's Focus.",
    );
    draft._features = { ...editsOf(draft), changed: {} };
    expect(check(draft, { ...at, mode: 'changes' })).toBeUndefined();
    expect(check(draft, { ...at, mode: 'full' })).toBe(
      "Two features at level 2 are called Monk's Focus.",
    );
  });
});

function edits3(registry: EntityRegistry, cls: Json): FeatureEdits {
  const arts = nodeOf(registry, cls, 'Martial Arts');
  return {
    changed: { [arts.ref]: { ...arts.base, entries: ['Lanterns.'] } },
    removed: [ref('Ability Score Improvement', 4)],
    added: [{ name: 'Watchful Step', level: 2, entries: [] }],
  };
}

describe('the class editor on screen', () => {
  function mount(registry: EntityRegistry, cls: Json) {
    const start: Json = {
      ...openClass(structuredClone(cls), { original: cls, registry }),
      name: 'Lantern',
    };
    let latest = start;
    function Harness() {
      const [draft, setDraft] = useState<Json>(start);
      latest = draft;
      return (
        <editor.Body
          draft={draft}
          change={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          original={cls}
          registry={registry}
          readOnly={false}
        />
      );
    }
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    return () => latest;
  }
  const pick = (name: string, mode: string) => {
    const header = screen.getByRole('button', { name: new RegExp(`^${name}`) });
    if (header.getAttribute('aria-expanded') !== 'true') fireEvent.click(header);
    fireEvent.click(
      within(screen.getByRole('group', { name: `${name}: keep, change or remove` })).getByRole(
        'button',
        { name: mode },
      ),
    );
  };

  it('opens on the table, a row per level, and removes a holder with what it holds', async () => {
    const { registry, cls } = book();
    const draft = mount(registry, cls);
    const table = await screen.findByRole('list', { name: 'Lantern by level' });
    expect(within(table).getAllByRole('button', { name: /^Level \d+,/ })).toHaveLength(20);
    const two = within(table).getByRole('button', { name: /^Level 2,/ });
    expect(two.textContent).toContain("Monk's Focus, Flurry of Blows, Patient Defense");
    fireEvent.click(two);
    expect(screen.getAllByText("Part of Monk's Focus")).toHaveLength(2);
    pick("Monk's Focus", 'Remove');
    expect(editsOf(draft()).removed).toEqual([
      ref("Monk's Focus", 2),
      ref('Flurry of Blows', 2),
      ref('Patient Defense', 2),
    ]);
    // Keep puts them all back.
    pick("Monk's Focus", 'Keep');
    expect(editsOf(draft()).removed).toEqual([]);
  });

  it('sets a pool by level in the table', async () => {
    const { registry, cls } = book();
    const draft = mount(registry, cls);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a pool' }));
    fireEvent.change(screen.getByLabelText('Pool name'), { target: { value: 'Vigil' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Level 5,/ }));
    fireEvent.change(screen.getByLabelText('Vigil at level 5'), { target: { value: '3' } });
    const [pool] = (draft().castGuidance as { effects: Json[] }).effects;
    expect(pool).toMatchObject({ label: 'Vigil', max: { byLevel: { '1': 2, '5': 3 } } });
  });
});
