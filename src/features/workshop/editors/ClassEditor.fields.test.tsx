// @vitest-environment jsdom
// U5c (ADR-002, board 5): the class fields. Each is edited as a player edits
// it, stored as Save stores it, read where the sheet or the creator reads it,
// and opened again unchanged. A copy whose features a table's change placed
// reads and writes them against the feature below the change, as the merge
// resolves the copy (U10).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { engineContextFor } from '@/data5e/engineAdapter';
import { type EntityRegistry, mergeHomebrew, normalizeDataset } from '@/data5e/normalize';
import { deriveSheet } from '@/engine/derive';
import { meetsMulticlassRequirements } from '@/engine/multiclass';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { coinLabel, parseStartingEquipment } from '@/features/creator/startingEquipment';
import { writeChange } from '../copyWriter';
import type { Json } from '../editorTypes';
import {
  editor,
  editsOf,
  featureTree,
  gearFrom,
  gearText,
  needsOf,
  needsWith,
  openClass,
  optionalValues,
  writeClass,
} from './ClassEditor';

afterEach(cleanup);

const ref = (name: string, level: number) => `${name}|Monk|XPHB|${level}`;
const feature = (name: string, level: number, entries: unknown[]): Json => ({
  name,
  source: 'XPHB',
  className: 'Monk',
  classSource: 'XPHB',
  level,
  entries,
});
const MONK: Json = {
  name: 'Monk',
  source: 'XPHB',
  hd: { number: 1, faces: 8 },
  proficiency: ['str', 'dex'],
  classFeatures: [ref('Martial Arts', 1), ref('Flurry of Blows', 2)],
};
const MONK_FILE = {
  class: [MONK],
  classFeature: [
    feature('Martial Arts', 1, ['Strike with your fists.']),
    feature('Flurry of Blows', 2, ['Two strikes.']),
  ],
};
const CLERIC: Json = {
  name: 'Cleric',
  source: 'PHB',
  hd: { number: 1, faces: 8 },
  proficiency: ['wis', 'cha'],
  casterProgression: 'full',
  spellcastingAbility: 'wis',
  preparedSpells: '<$level$> + <$wis_mod$>',
  cantripProgression: Array(20).fill(3),
  classFeatures: [],
};
const ITEMS = [
  { name: 'Longsword', source: 'PHB', type: 'M' },
  { name: 'Javelin', source: 'PHB', type: 'M' },
  { name: 'Bless', source: 'PHB' },
];
const SPELLS = [
  { name: 'Bless', source: 'PHB', level: 1 },
  { name: 'Shield', source: 'PHB', level: 1 },
];
const INVOCATIONS = [
  { name: 'Agonizing Blast', source: 'PHB', featureType: ['EI'], entries: ['More damage.'] },
  { name: 'Devil Sight', source: 'PHB', featureType: ['EI'], entries: ['See in the dark.'] },
];

/** The Monk and Cleric books, and `change` (a table's change) as a changes-role file. */
function world(changes: Record<string, Json[]> = {}, mine?: Record<string, unknown>) {
  const registry = normalizeDataset(
    new Map<string, unknown>([
      ['class/class-monk.json', MONK_FILE],
      ['class/class-cleric.json', { class: [CLERIC] }],
      ['items-base.json', { baseitem: ITEMS.slice(0, 2) }],
      ['spells/spells-phb.json', { spell: SPELLS }],
      ['optionalfeatures.json', { optionalfeature: INVOCATIONS }],
    ]),
  );
  const files = new Map<string, Record<string, unknown>>();
  if (Object.keys(changes).length > 0)
    files.set('table', { _meta: { sources: [{ json: 'MyChanges' }] }, ...changes });
  if (mine !== undefined)
    files.set('mine', { _meta: { sources: [{ json: 'MyHomebrew' }] }, ...mine });
  if (files.size > 0) mergeHomebrew(registry, files, new Map(), new Set(['table']));
  return registry;
}

/** The class editor on screen; the draft as it stands, and how often it changed. */
function mount(start: Json, registry: EntityRegistry, original?: Json) {
  let latest = start;
  let changes = 0;
  function Harness() {
    const [draft, setDraft] = useState(start);
    latest = draft;
    const change = (patch: Json) => {
      changes++;
      setDraft((d) => {
        const next = { ...d, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
        return next;
      });
    };
    return (
      <editor.Body
        draft={draft}
        change={change}
        original={original}
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
  return { draft: () => latest, changes: () => changes };
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const box = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
const chip = (group: string, name: string) =>
  fireEvent.click(within(screen.getByRole('group', { name: group })).getByRole('button', { name }));
const pressed = (group: string, name: string) =>
  within(screen.getByRole('group', { name: group }))
    .getByRole('button', { name })
    .getAttribute('aria-pressed');
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

/** Saved as a new class in the player's book. */
const saveNew = (draft: Json, registry: EntityRegistry) =>
  writeClass({ draft, source: 'MyHomebrew', mode: 'full', registry });

/** A character of `classes`, each `[name, source, levels]`, its scores `scores`. */
function hero(
  classes: Array<[string, string, number]>,
  scores: Partial<CharacterDoc['abilities']['base']> = {},
) {
  const doc = newCharacterDoc('c', 'Hero', 't');
  doc.classes = classes.map(([name, source, levels]) => ({
    ref: { name, source },
    levels,
    hp: Array(levels).fill('avg'),
  }));
  doc.abilities = { ...doc.abilities, base: { ...doc.abilities.base, ...scores } };
  return doc;
}

describe('multiclassing requirements', () => {
  it('reads one score for one ability or more, all of them or one, and keeps any other shape', () => {
    expect(needsOf({ cha: 13 })).toEqual({ abilities: ['cha'], score: 13, any: false });
    expect(needsOf({ dex: 13, wis: 13 })).toEqual({
      abilities: ['dex', 'wis'],
      score: 13,
      any: false,
    });
    // The 2014 Fighter's "Strength 13 or Dexterity 13".
    expect(needsOf({ or: [{ str: 13, dex: 13 }] })).toEqual({
      abilities: ['str', 'dex'],
      score: 13,
      any: true,
    });
    expect(needsOf(undefined)).toEqual({ abilities: [], score: 13, any: false });
    expect(needsOf({ str: 13, dex: 15 })).toBeUndefined();
    expect(needsOf({ cha: 13, or: [{ str: 13 }] })).toBeUndefined();
  });

  it('writes one of them as one score each, which the Build tab checks as either', () => {
    const one = needsWith({ abilities: ['str', 'dex'], score: 13, any: true });
    expect(one).toEqual({ or: [{ str: 13 }, { dex: 13 }] });
    const cls = { multiclassing: { requirements: one } };
    const scores = { str: 8, dex: 14, con: 10, int: 10, wis: 10, cha: 10 };
    expect(meetsMulticlassRequirements(cls, scores)).toBe(true);
    const all = {
      multiclassing: {
        requirements: needsWith({ abilities: ['str', 'dex'], score: 13, any: false }),
      },
    };
    expect(meetsMulticlassRequirements(all, scores)).toBe(false);
    expect(needsWith({ abilities: [], score: 13, any: false })).toBeUndefined();
  });
});

describe('starting equipment', () => {
  const items = ITEMS as Json[];

  it('says each piece in words, and reads typed words back as the creator reads them', () => {
    expect(gearText('chain mail|phb')).toBe('chain mail');
    expect(gearText({ item: 'javelin|xphb', quantity: 8 })).toBe('javelin x8');
    expect(gearText({ equipmentType: 'weaponMartial', quantity: 2 })).toBe('any martial weapon x2');
    expect(gearText({ equipmentTypes: ['instrumentMusical', 'toolArtisan'] })).toBe(
      "a musical instrument or artisan's tools",
    );
    expect(gearText({ special: 'a lucky coin' })).toBe('a lucky coin');
    for (const cp of [1000, 1550, 15500, 7, 0]) expect(gearText({ value: cp })).toBe(coinLabel(cp));
    expect(gearText({ unknown: true })).toBeUndefined();

    expect(gearFrom('Longsword', [], items)).toBe('Longsword|phb');
    expect(gearFrom('javelin x4', [], items)).toEqual({ item: 'javelin|phb', quantity: 4 });
    expect(gearFrom('10 gp', [], items)).toEqual({ value: 1000 });
    expect(gearFrom('any martial weapon x2', [], items)).toEqual({
      equipmentType: 'weaponMartial',
      quantity: 2,
    });
    expect(gearFrom('a lucky coin', [], items)).toEqual({ special: 'a lucky coin' });
    // What the option had in the same words is kept as it was, its tags too.
    const kept = { item: 'shield|phb', displayName: 'a shield' };
    expect(gearFrom('shield', [kept], items)).toBe(kept);
  });

  it('saves the choices typed, which the creator offers, and opens them again unchanged', () => {
    const registry = world();
    const at = mount({ name: 'Lantern', ...editor.blank() }, registry);
    press('Add gear');
    type('Gear 1', 'Longsword, 10 gp');
    press('Make it a choice');
    type('Choice 1, option B', 'javelin x4, a lucky coin');
    const se = at.draft().startingEquipment;
    expect(se).toEqual({
      defaultData: [
        {
          A: ['Longsword|phb', { value: 1000 }],
          B: [{ item: 'javelin|phb', quantity: 4 }, { special: 'a lucky coin' }],
        },
      ],
    });
    const groups = parseStartingEquipment({ startingEquipment: se } as never);
    expect(groups[0]?.map((b) => b.label)).toEqual([
      '(A) Longsword, 10 gp',
      '(B) javelin ×4, a lucky coin',
    ]);
    const { entry } = saveNew(at.draft(), registry);
    cleanup();
    const again = mount(openClass(structuredClone(entry), { registry }), registry);
    expect(box('Choice 1, option A')).toBe('Longsword, 10 gp');
    expect(box('Choice 1, option B')).toBe('javelin x4, a lucky coin');
    expect(again.changes()).toBe(0);
  });

  it('keeps a count as it is typed: x1 on the way to x10', () => {
    const at = mount({ name: 'Lantern', ...editor.blank() }, world());
    press('Add gear');
    const gear = () => Object.values((at.draft().startingEquipment as Json).defaultData[0])[0];
    type('Gear 1', 'javelin x1');
    expect(box('Gear 1')).toBe('javelin x1');
    expect(gear()).toEqual([{ item: 'javelin|phb', quantity: 1 }]);
    type('Gear 1', 'javelin x10');
    expect(box('Gear 1')).toBe('javelin x10');
    expect(gear()).toEqual([{ item: 'javelin|phb', quantity: 10 }]);
    type('Gear 1', 'any martial weapon x1');
    expect(box('Gear 1')).toBe('any martial weapon x1');
    const parsed = parseStartingEquipment({ startingEquipment: at.draft().startingEquipment } as never);
    expect(parsed[0]?.[0]?.items[0]?.quantity).toBe(1);
  });

  it("drops the book's words for the old kit once the kit is changed", () => {
    const registry = world();
    const at = mount(
      {
        name: 'Lantern',
        ...editor.blank(),
        startingEquipment: {
          additionalFromBackground: true,
          default: ['(a) a longsword'],
          defaultData: [{ a: ['longsword|phb'], b: [{ value: 500 }] }],
        },
      },
      registry,
    );
    press('Remove choice 1, option B');
    expect(at.draft().startingEquipment).toEqual({
      additionalFromBackground: true,
      defaultData: [{ a: ['longsword|phb'] }],
    });
  });
});

describe('the Basics fields', () => {
  it('saves tools, multiclassing and the class spells, read on the sheet, and opens them unchanged', () => {
    const registry = world();
    const at = mount({ name: 'Lantern', ...editor.blank() }, registry);
    type('Tools', "Thieves' tools");
    chip('Scores it needs', 'Strength');
    chip('Scores it needs', 'Dexterity');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Needs' })).getByRole('button', {
        name: 'One of them',
      }),
    );
    type('Score needed', '15');
    chip('Armor gained', 'Light');
    type('Tools gained', "Thieves' tools");
    press('Add spells at a level');
    type('Spell row 1: spells', 'Bless, Shield');
    const draft = at.draft();
    expect(draft.startingProficiencies).toEqual({ tools: ["Thieves' tools"] });
    expect(draft.multiclassing).toEqual({
      requirements: { or: [{ str: 15 }, { dex: 15 }] },
      proficienciesGained: { armor: ['light'], tools: ["Thieves' tools"] },
    });
    expect(draft.additionalSpells).toEqual([{ prepared: { '1': ['Bless|PHB', 'Shield|PHB'] } }]);

    const { entry } = saveNew(draft, registry);
    const sheetWorld = world({}, { class: [structuredClone(entry)] });
    const first = deriveSheet(
      hero([['Lantern', 'MyHomebrew', 1]]),
      engineContextFor(sheetWorld, {}),
    );
    expect(first.toolProfs).toContain("Thieves' tools");
    expect(first.grantedSpells.filter((s) => s.usage === 'prepared').map((s) => s.name)).toEqual([
      'Bless',
      'Shield',
    ]);
    // As a second class: what it gives a character taking it later.
    const second = deriveSheet(
      hero([
        ['Monk', 'XPHB', 1],
        ['Lantern', 'MyHomebrew', 1],
      ]),
      engineContextFor(sheetWorld, {}),
    );
    expect(second.armorProfs).toContain('light');

    cleanup();
    const again = mount(openClass(structuredClone(entry), { registry }), registry);
    expect(box('Tools')).toBe("Thieves' tools");
    expect(pressed('Scores it needs', 'Dexterity')).toBe('true');
    expect(pressed('Needs', 'One of them')).toBe('true');
    expect(box('Score needed')).toBe('15');
    expect(box('Spell row 1: spells')).toBe('Bless, Shield');
    expect(again.changes()).toBe(0);
  });

  it('keeps the skills to choose from while their count is retyped, and none once left empty', () => {
    const skills = [{ choose: { from: ['history', 'insight', 'medicine'], count: 2 } }];
    const at = mount(
      { name: 'Lantern', ...editor.blank(), startingProficiencies: { skills } },
      world(),
    );
    type('Skills to choose', '');
    expect(box('Skills to choose')).toBe('');
    expect((at.draft().startingProficiencies as Json).skills).toEqual(skills);
    type('Skills to choose', '3');
    expect((at.draft().startingProficiencies as Json).skills).toEqual([
      { choose: { from: ['history', 'insight', 'medicine'], count: 3 } },
    ]);
    type('Skills to choose', '');
    fireEvent.blur(screen.getByLabelText('Skills to choose'));
    expect(at.draft().startingProficiencies).toBeUndefined();
  });

  it("keeps a tool's tag while its words are as they were", () => {
    const registry = world();
    const at = mount(
      {
        name: 'Lantern',
        ...editor.blank(),
        startingProficiencies: {
          tools: ["{@item thieves' tools|phb}"],
          toolProficiencies: [{ "thieves' tools": true }],
        },
      },
      registry,
    );
    expect(box('Tools')).toBe("thieves' tools");
    type('Tools', "thieves' tools, Herbalism kit");
    expect(at.draft().startingProficiencies).toEqual({
      tools: ["{@item thieves' tools|phb}", 'Herbalism kit'],
    });
  });

  it("leaves the pools to the table: the class's own cards keep them as they were", () => {
    const registry = world();
    const pool = {
      kind: 'resource',
      key: 'pool-1',
      label: 'Ki',
      max: { byLevel: { '2': 2 } },
      reset: 'short',
    };
    const at = mount(
      {
        name: 'Lantern',
        ...editor.blank(),
        castGuidance: { v: 1, effects: [pool, { kind: 'acBonus', amount: 1 }] },
      },
      registry,
    );
    const section = screen
      .getByRole('heading', { name: 'What it does on the sheet' })
      .closest('section');
    expect(section).not.toBeNull();
    // No card for the pool: its name and numbers are the table's.
    expect(within(section as HTMLElement).queryByLabelText('Uses per rest: Name')).toBeNull();
    expect(within(section as HTMLElement).getByLabelText('Armor Class: Amount')).toBeTruthy();
    type('Armor Class: Amount', '2');
    expect(at.draft().castGuidance).toEqual({
      v: 1,
      effects: [pool, { kind: 'acBonus', amount: 2 }],
    });
    const { entry } = saveNew(at.draft(), registry);
    const sheetWorld = world({}, { class: [structuredClone(entry)] });
    const sheet = deriveSheet(
      hero([['Lantern', 'MyHomebrew', 2]]),
      engineContextFor(sheetWorld, {}),
    );
    expect(sheet.ac.parts.some((p) => p.label === 'Lantern' && p.amount === 2)).toBe(true);
    expect(sheet.resources.some((r) => r.label === 'Ki' && r.max === 2)).toBe(true);
  });
});

describe('optional features by level', () => {
  it('counts a list the class names, read the same from a list of twenty, a table or its *', () => {
    expect(optionalValues({ progression: [0, 2, 2, 2, 3] }).slice(0, 6)).toEqual([
      0, 2, 2, 2, 3, 0,
    ]);
    expect(optionalValues({ progression: { '2': 2, '5': 3 } }).slice(0, 6)).toEqual([
      0, 2, 2, 2, 3, 3,
    ]);
    expect(optionalValues({ progression: { '*': 1, '5': 3 } }).slice(0, 6)).toEqual([
      1, 1, 1, 1, 3, 3,
    ]);
  });

  it('will not save a count that falls, which the sheet would not give', () => {
    const style = (progression: unknown) => ({
      name: 'Lantern',
      ...editor.blank(),
      optionalfeatureProgression: [{ name: 'Fighting Style', featureType: ['FS:F'], progression }],
    });
    expect(editor.check?.(style({ '1': 2, '10': 1 }))).toBe(
      'Fighting Style has fewer at level 10 than before. The sheet keeps the most so far, so set it no lower.',
    );
    expect(editor.check?.(style([2, 2, 1]))).toMatch(/at level 3/);
    expect(editor.check?.(style({ '1': 1, '10': 2 }))).toBeUndefined();
  });

  it('saves a list to pick from and how many by level, a pick on the sheet', async () => {
    const registry = world();
    const at = mount({ name: 'Lantern', ...editor.blank() }, registry);
    press('Table');
    press('Add optional features');
    expect(editor.check?.(at.draft())).toBe('Pick the list Optional features picks from.');
    type('Optional feature name', 'Invocations');
    chip('Invocations: picks from', 'Eldritch invocation');
    fireEvent.change(await screen.findByLabelText('Invocations at level 1'), {
      target: { value: '2' },
    });
    expect(at.draft().optionalfeatureProgression).toEqual([
      { name: 'Invocations', featureType: ['EI'], progression: { '1': 2 } },
    ]);
    expect(editor.check?.(at.draft())).toBeUndefined();
    const { entry } = saveNew(at.draft(), registry);
    const sheetWorld = world({}, { class: [structuredClone(entry)] });
    const sheet = deriveSheet(
      hero([['Lantern', 'MyHomebrew', 1]]),
      engineContextFor(sheetWorld, {}),
    );
    const pick = sheet.pending.find((p) => p.label === 'Invocations');
    expect(pick?.count).toBe(2);
    expect(pick?.options.map((o) => o.label)).toEqual([
      'Agonizing Blast (PHB)',
      'Devil Sight (PHB)',
    ]);
  });
});

describe('the number of spells it prepares', () => {
  const preparedAt = (registry: EntityRegistry, level: number) =>
    deriveSheet(
      hero([['Shrine', 'MyHomebrew', level]], { wis: 16 }),
      engineContextFor(registry, {}),
    ).spellcasting[0]?.preparedMax;

  /** A copy of the Cleric saved with the spellcasting the player set, on the sheet. */
  function copied(set: () => void) {
    cleanup();
    const registry = world();
    const cls = registry.get('class', 'Cleric', 'PHB') as Json;
    const at = mount(openClass(structuredClone(cls), { original: cls, registry }), registry, cls);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Part of the class' })).getByRole('button', {
        name: 'Basics',
      }),
    );
    set();
    const draft = { ...at.draft(), name: 'Shrine' };
    const { entry } = writeClass({
      original: cls,
      copied: cls,
      draft,
      source: 'MyHomebrew',
      mode: 'changes',
      registry,
    });
    return world({}, { class: [structuredClone(entry)] });
  }

  it('is the formula the copy keeps, half its level with a formula changed', () => {
    expect(
      preparedAt(
        copied(() => {}),
        5,
      ),
    ).toBe(8);
    const half = copied(() =>
      fireEvent.change(screen.getByLabelText('How many it prepares'), {
        target: { value: 'half' },
      }),
    );
    expect(preparedAt(half, 5)).toBe(5);
  });

  it('follows the table once a formula class sets one, its formula stored as none', () => {
    const table = copied(() =>
      fireEvent.change(screen.getByLabelText('How many it prepares'), {
        target: { value: 'table' },
      }),
    );
    expect((table.get('class', 'Shrine', 'MyHomebrew') as Json).preparedSpells).toBeNull();
    // Started from the counts of the first full caster with a table: none here, so 0s to set.
    expect(preparedAt(table, 5)).toBe(0);
  });
});

describe('a copy of a class whose feature a table changed (U10)', () => {
  const flurryChange = () => {
    const base = normalizeDataset(new Map([['class/class-monk.json', MONK_FILE]]));
    const flurry = base.get('classFeature', 'Flurry of Blows', 'XPHB') as Json;
    return [
      writeChange('classFeature', flurry, { ...flurry, entries: ['Three strikes.'] }) as Entity,
    ];
  };
  const tableWorld = (mine?: Record<string, unknown>) =>
    world({ classFeature: flurryChange() }, mine);

  /** The Monk copied with Flurry of Blows renamed (its text as `entries`), saved, then loaded. */
  function renamed(entries?: unknown[]) {
    const registry = tableWorld();
    const cls = registry.get('class', 'Monk', 'XPHB') as Json;
    const draft = openClass(structuredClone(cls), { original: cls, registry });
    const node = featureTree(cls, registry).find((n) => n.entity?.name === 'Flurry of Blows');
    if (node === undefined) throw new Error('no Flurry of Blows');
    expect(node.base.entries).toEqual(['Three strikes.']);
    draft.name = 'Lantern';
    draft._features = {
      ...editsOf(draft),
      changed: {
        [node.ref]: { ...node.base, name: 'Flurry of Fists', ...(entries ? { entries } : {}) },
      },
    };
    const written = writeClass({
      original: cls,
      copied: cls,
      draft,
      source: 'MyHomebrew',
      mode: 'changes',
      registry,
    });
    const file = {
      class: [structuredClone(written.entry)],
      classFeature: structuredClone(written.owned),
    };
    return { written, file, loaded: tableWorld(structuredClone(file)), ref: node.ref };
  }

  it("keeps the table's change in the copy, as the sheet resolves it", () => {
    const { loaded } = renamed();
    const mine = loaded.get('classFeature', 'Flurry of Fists', 'MyHomebrew') as Json;
    expect(mine.entries).toEqual(['Three strikes.']);
  });

  it('reads a copy that went back to the book below the change as the book, not the table', () => {
    const { written, file, loaded, ref: at } = renamed(['Two strikes.']);
    expect(loaded.get('classFeature', 'Flurry of Fists', 'MyHomebrew')?.entries).toEqual([
      'Two strikes.',
    ]);
    const cls = loaded.get('class', 'Monk', 'XPHB') as Json;
    const draft = openClass(structuredClone(written.entry), {
      original: cls,
      registry: loaded,
      file: { _meta: {}, ...file },
    });
    expect(editsOf(draft).changed[at]?.entries).toEqual(['Two strikes.']);
  });
});
