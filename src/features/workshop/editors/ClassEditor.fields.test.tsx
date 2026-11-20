// @vitest-environment jsdom
// U5c (ADR-002, board 5): the class fields. Each is edited as a player edits
// it, stored as Save stores it, read where the sheet or the creator reads it,
// and opened again unchanged. A copy whose features a table's change placed
// reads and writes them against the feature below the change, as the merge
// resolves the copy (U10).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { engineContextFor } from '@/data5e/engineAdapter';
import { type EntityRegistry, mergeHomebrew, normalizeDataset } from '@/data5e/normalize';
import { deriveSheet } from '@/engine/derive';
import { meetsMulticlassRequirements } from '@/engine/multiclass';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { coinLabel, parseStartingEquipment } from '@/features/creator/startingEquipment';
import { bookAt, spellColumns } from '../classFields';
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

// The items are in, unless a test says they are still loading.
const packs = vi.hoisted(() => ({ status: 'ready' as 'loading' | 'ready' | 'error' }));
vi.mock('@/data5e/hooks', async (load) => ({
  ...(await load<typeof import('@/data5e/hooks')>()),
  useTypePacks: () => ({
    status: packs.status,
    error: null,
    offline: false,
    retry: () => undefined,
  }),
}));

afterEach(() => {
  cleanup();
  packs.status = 'ready';
});

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
      ['items.json', { item: [{ name: 'Bag of Holding', source: 'DMG' }] }],
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
    // "Strength and Constitution 13, or Intelligence 13" is more than one list of scores says.
    expect(needsOf({ or: [{ str: 13, con: 13 }, { int: 13 }] })).toBeUndefined();
    expect(needsOf({ or: [] })).toBeUndefined();
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

  it('needs no score past 30', () => {
    const at = mount({ name: 'Lantern', ...editor.blank() }, world());
    chip('Scores it needs', 'Strength');
    type('Score needed', '45');
    expect((at.draft().multiclassing as Json).requirements).toEqual({ str: 30 });
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

  it('reads coins of more than one kind, one of several kinds, and the same gear retyped', () => {
    expect(gearFrom('15 gp 5 sp', [], items)).toEqual({ value: 1550 });
    expect(gearFrom(gearText({ value: 1550 }) ?? '', [], items)).toEqual({ value: 1550 });
    expect(gearFrom('2 GP 3 cp', [], items)).toEqual({ value: 203 });
    expect(gearFrom("a musical instrument or artisan's tools x2", [], items)).toEqual({
      equipmentTypes: ['instrumentMusical', 'toolArtisan'],
      quantity: 2,
    });
    // A kind the creator has no words for stays that kind, its count retyped.
    const ranged = { equipmentType: 'weaponMartialRanged' };
    expect(gearFrom('weaponMartialRanged x2', [ranged], items)).toEqual({
      equipmentType: 'weaponMartialRanged',
      quantity: 2,
    });
    // In other letters, or with a count, a pouch keeps the coins its words do not show.
    const pouch = { item: 'pouch|phb', containsValue: 1500 };
    expect(gearFrom('Pouch', [pouch], items)).toEqual({ item: 'Pouch|phb', containsValue: 1500 });
    expect(gearFrom('pouch x3', [pouch], items)).toEqual({ ...pouch, quantity: 3 });
    // An item named without a printing stays without one.
    const bare = { item: 'pouch', containsValue: 1500 };
    expect(gearFrom('pouch x2', [bare], items)).toEqual({ ...bare, quantity: 2 });
    // Coins are their words: retyped, they are what the words now say.
    expect(gearFrom('5 gp', [{ value: 1000 }], items)).toEqual({ value: 500 });
    // So is gear in words alone: in other letters, or counted, it is read again.
    expect(gearFrom('Longsword x2', [{ special: 'longsword' }], items)).toEqual({
      item: 'Longsword|phb',
      quantity: 2,
    });
    // An item keeps its printing, which its words do not show.
    expect(gearFrom('javelin x4', ['javelin|xphb'], items)).toEqual({
      item: 'javelin|xphb',
      quantity: 4,
    });
    expect(gearFrom('Javelin', ['javelin|xphb'], items)).toBe('Javelin|xphb');
  });

  it("keeps a pouch's coins while its count is typed a key at a time", () => {
    const pouch = { item: 'pouch|phb', containsValue: 1500 };
    const at = mount(
      { name: 'Lantern', ...editor.blank(), startingEquipment: { defaultData: [{ _: [pouch] }] } },
      world(),
    );
    const gear = () => ((at.draft().startingEquipment as Json).defaultData as Json[])[0]?._;
    fireEvent.focus(screen.getByLabelText('Gear 1'));
    type('Gear 1', 'pouch x');
    expect(gear()).toEqual([{ special: 'pouch x' }]);
    type('Gear 1', 'pouch x2');
    expect(gear()).toEqual([{ ...pouch, quantity: 2 }]);
    type('Gear 1', 'pouch x');
    type('Gear 1', 'pouch');
    expect(gear()).toEqual([pouch]);
  });

  it("keeps a pouch's coins in a box that now holds other gear, from when it is entered", () => {
    const pouch = { item: 'pouch|phb', containsValue: 1500 };
    const at = mount(
      {
        name: 'Lantern',
        ...editor.blank(),
        startingEquipment: { defaultData: [{ _: ['longsword|phb'] }, { _: [pouch] }] },
      },
      world(),
    );
    press('Remove gear 1');
    const gear = () => ((at.draft().startingEquipment as Json).defaultData as Json[])[0]?._;
    expect(box('Gear 1')).toBe('pouch');
    fireEvent.focus(screen.getByLabelText('Gear 1'));
    type('Gear 1', 'pouch x');
    type('Gear 1', 'pouch x2');
    expect(gear()).toEqual([{ ...pouch, quantity: 2 }]);
  });

  it('reads words taken out and typed again afresh, not as the words they were', () => {
    const at = mount(
      {
        name: 'Lantern',
        ...editor.blank(),
        startingEquipment: { defaultData: [{ _: [{ special: 'longsword' }] }] },
      },
      world(),
    );
    const gear = () => ((at.draft().startingEquipment as Json).defaultData as Json[])[0]?._;
    fireEvent.focus(screen.getByLabelText('Gear 1'));
    type('Gear 1', '');
    type('Gear 1', 'longsword');
    expect(gear()).toEqual(['longsword|phb']);
  });

  it('waits for the items before gear can be typed, else a name would be kept as words', () => {
    const start = {
      name: 'Lantern',
      ...editor.blank(),
      startingEquipment: { defaultData: [{ _: ['longsword|phb'] }] },
    };
    packs.status = 'loading';
    mount(structuredClone(start), world());
    expect((screen.getByLabelText('Gear 1') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Loading the items…')).toBeTruthy();
    cleanup();
    packs.status = 'ready';
    mount(structuredClone(start), world());
    expect((screen.getByLabelText('Gear 1') as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText('Loading the items…')).toBeNull();
    // Downloaded, but not yet in the registry the editor reads.
    cleanup();
    const bare = normalizeDataset(
      new Map<string, unknown>([['items-base.json', { baseitem: ITEMS.slice(0, 2) }]]),
    );
    mount(structuredClone(start), bare);
    expect((screen.getByLabelText('Gear 1') as HTMLInputElement).disabled).toBe(true);
    // Not loaded at all: the box is open, and says how a name is read.
    cleanup();
    packs.status = 'error';
    mount(structuredClone(start), bare);
    expect((screen.getByLabelText('Gear 1') as HTMLInputElement).disabled).toBe(false);
    expect(
      screen.getByText(/could not be loaded, so a name typed is kept as written/),
    ).toBeTruthy();
  });

  it('adds an option beside one keyed `_`, which stays one of the options', () => {
    const group = { _: ['longsword|phb'], a: ['javelin|phb'] };
    const at = mount(
      { name: 'Lantern', ...editor.blank(), startingEquipment: { defaultData: [group] } },
      world(),
    );
    press('Add an option');
    expect((at.draft().startingEquipment as Json).defaultData).toEqual([{ ...group, b: [] }]);
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
    const gear = () =>
      Object.values(((at.draft().startingEquipment as Json).defaultData as Json[])[0] ?? {})[0];
    type('Gear 1', 'javelin x1');
    expect(box('Gear 1')).toBe('javelin x1');
    expect(gear()).toEqual([{ item: 'javelin|phb', quantity: 1 }]);
    type('Gear 1', 'javelin x10');
    expect(box('Gear 1')).toBe('javelin x10');
    expect(gear()).toEqual([{ item: 'javelin|phb', quantity: 10 }]);
    // None of a gear is still one: the creator gives what it names.
    type('Gear 1', 'javelin x0');
    expect(gear()).toEqual([{ item: 'javelin|phb', quantity: 1 }]);
    type('Gear 1', 'any martial weapon x1');
    expect(box('Gear 1')).toBe('any martial weapon x1');
    const parsed = parseStartingEquipment({
      startingEquipment: at.draft().startingEquipment,
    } as never);
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
    // One option left is gear, not a choice of one.
    expect(at.draft().startingEquipment).toEqual({
      additionalFromBackground: true,
      defaultData: [{ _: ['longsword|phb'] }],
    });
    expect(box('Gear 1')).toBe('longsword');
  });

  it("keeps the book's words for its kit while what the creator gives is as it was", () => {
    const words = { default: ['(a) a longsword'], entries: ['A longsword.'] };
    const at = mount(
      {
        name: 'Lantern',
        ...editor.blank(),
        startingEquipment: { ...words, defaultData: [{ _: ['longsword|phb'] }] },
      },
      world(),
    );
    const se = () => at.draft().startingEquipment as Json;
    press('Make it a choice');
    expect(se()).toEqual({ ...words, defaultData: [{ A: ['longsword|phb'], B: [] }] });
    press('Remove choice 1, option B');
    expect(se()).toEqual({ ...words, defaultData: [{ _: ['longsword|phb'] }] });
    press('Add gear');
    expect(se()).toMatchObject(words);
    type('Gear 2', 'javelin');
    expect(se()).toEqual({ defaultData: [{ _: ['longsword|phb'] }, { _: ['javelin|phb'] }] });
  });

  it('says a kit in words alone is kept until gear is added', () => {
    mount(
      {
        name: 'Lantern',
        ...editor.blank(),
        startingEquipment: { default: ['A sword and a shield.'] },
      },
      world(),
    );
    expect(
      screen.getByText(/in words only, kept as written until gear is added here/),
    ).toBeTruthy();
    cleanup();
    mount(
      {
        name: 'Lantern',
        ...editor.blank(),
        startingEquipment: { entries: ['You start with a sword and a shield.'] },
      },
      world(),
    );
    expect(
      screen.getByText(/in words only, kept as written until gear is added here/),
    ).toBeTruthy();
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
    expect(second.toolProfs).toContain("Thieves' tools");

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

  it('takes 0 skills to choose as none', () => {
    const skills = [{ choose: { from: ['history', 'insight'], count: 1 } }];
    const at = mount(
      { name: 'Lantern', ...editor.blank(), startingProficiencies: { skills } },
      world(),
    );
    type('Skills to choose', '0');
    expect(at.draft().startingProficiencies).toBeUndefined();
  });

  it('keeps what a spell block has besides its spells while they are typed again', () => {
    const at = mount(
      {
        name: 'Lantern',
        ...editor.blank(),
        additionalSpells: [{ ability: 'cha', prepared: { '3': ['Bless|PHB'] } }],
      },
      world(),
    );
    type('Spell row 1: spells', '');
    expect(at.draft().additionalSpells).toBeUndefined();
    type('Spell row 1: spells', 'Shield');
    expect(at.draft().additionalSpells).toEqual([
      { ability: 'cha', prepared: { '3': ['Shield|PHB'] } },
    ]);
  });

  it('will not save more skills to choose than it names', () => {
    const base = { name: 'Lantern', ...editor.blank() };
    const choose = (from: string[], count: number) => ({ skills: [{ choose: { from, count } }] });
    expect(
      editor.check?.({ ...base, startingProficiencies: choose(['history', 'insight'], 3) }),
    ).toBe('The skills to choose are 3, from a list of 2. Name more, or choose fewer.');
    expect(
      editor.check?.({ ...base, multiclassing: { proficienciesGained: choose(['history'], 2) } }),
    ).toBe('The skills gained are 2, from a list of 1. Name more, or choose fewer.');
    expect(
      editor.check?.({ ...base, startingProficiencies: choose(['history', 'insight'], 2) }),
    ).toBeUndefined();
    // A choice from no list is from every skill, as the creator offers it.
    expect(editor.check?.({ ...base, startingProficiencies: choose([], 3) })).toBeUndefined();
  });

  it('starts a table of prepared spells for a copy whose formula is none', () => {
    const at = mount({ name: 'Lantern', ...editor.blank(), preparedSpells: null }, world());
    fireEvent.change(screen.getByLabelText('Spellcasting'), { target: { value: 'full' } });
    expect(at.draft().preparedSpellsProgression).toEqual(Array(20).fill(0));
  });

  it('keeps a list of none: a class knowing no spells at level 1 still knows its spells', async () => {
    const at = mount(
      {
        name: 'Lantern',
        ...editor.blank(),
        casterProgression: 'full',
        spellcastingAbility: 'int',
        spellsKnownProgression: Array(20).fill(1),
      },
      world(),
    );
    press('Table');
    fireEvent.change(await screen.findByLabelText('Known at level 1'), { target: { value: '0' } });
    expect(at.draft().spellsKnownProgression).toEqual(Array(20).fill(0));
    expect(at.draft()).not.toHaveProperty('preparedSpellsProgression');
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
    // Past the list's end, the most so far, as the sheet gives it.
    expect(optionalValues({ progression: [0, 2, 2, 2, 3] }).slice(0, 6)).toEqual([
      0, 2, 2, 2, 3, 3,
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
    expect(editor.check?.(style([2, null, 1]))).toMatch(/at level 3/);
    expect(editor.check?.(style({ '1': 1, '10': 2 }))).toBeUndefined();
    // A list read as far as it goes, its numbers only, as the sheet reads it.
    expect(editor.check?.(style([1, 1, 2]))).toBeUndefined();
    expect(editor.check?.(style([1, null, 2]))).toBeUndefined();
  });

  it('shows a count that falls as the list says it, to be set right', async () => {
    const at = mount(
      {
        name: 'Lantern',
        ...editor.blank(),
        optionalfeatureProgression: [
          { name: 'Fighting Style', featureType: ['FS:F'], progression: [2, 2, 1] },
        ],
      },
      world(),
    );
    press('Table');
    const row = await screen.findByRole('button', { name: /^Level 3,/ });
    expect(row.getAttribute('aria-label')).toContain('Fighting Style 1');
    // Past the list's end, the most so far, as the sheet gives it.
    const fourth = screen.getByRole('button', { name: /^Level 4,/ });
    expect(fourth.getAttribute('aria-label')).toContain('Fighting Style 2');
    expect(editor.check?.(at.draft())).toMatch(/at level 3/);
    fireEvent.click(row);
    type('Fighting Style at level 3', '2');
    expect(editor.check?.(at.draft())).toBeUndefined();
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
  async function copied(set: () => unknown) {
    cleanup();
    const registry = world();
    const cls = registry.get('class', 'Cleric', 'PHB') as Json;
    const at = mount(openClass(structuredClone(cls), { original: cls, registry }), registry, cls);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Part of the class' })).getByRole('button', {
        name: 'Basics',
      }),
    );
    await set();
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

  it('is the formula the copy keeps, half its level with a formula changed', async () => {
    expect(preparedAt(await copied(() => {}), 5)).toBe(8);
    const half = await copied(() =>
      fireEvent.change(screen.getByLabelText('How many it prepares'), {
        target: { value: 'half' },
      }),
    );
    expect(preparedAt(half, 5)).toBe(5);
  });

  it('follows the table once a formula class sets one, its formula stored as none', async () => {
    const table = await copied(() =>
      fireEvent.change(screen.getByLabelText('How many it prepares'), {
        target: { value: 'table' },
      }),
    );
    expect((table.get('class', 'Shrine', 'MyHomebrew') as Json).preparedSpells).toBeNull();
    // Started from the counts of the first full caster with a table: none here, so 0s to set.
    expect(preparedAt(table, 5)).toBe(0);
  });

  it('gives the counts set in its table, level by level', async () => {
    const table = await copied(async () => {
      fireEvent.change(screen.getByLabelText('How many it prepares'), {
        target: { value: 'table' },
      });
      fireEvent.click(
        within(screen.getByRole('group', { name: 'Part of the class' })).getByRole('button', {
          name: 'Table',
        }),
      );
      fireEvent.change(await screen.findByLabelText('Prepared at level 1'), {
        target: { value: '4' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^Level 5,/ }));
      type('Prepared at level 5', '6');
    });
    expect(preparedAt(table, 4)).toBe(4);
    expect(preparedAt(table, 5)).toBe(6);
  });
});

describe('its own slot table, saved again and again', () => {
  // A converted class's slots, from level 1: not what 1/3 gives, read first by the sheet.
  const ODD = Array.from({ length: 20 }, (_, i) => (i < 6 ? [2] : [3, 1]));
  const KEY = { name: 'Lantern', source: 'MyHomebrew' };
  const STORED: Json = {
    ...KEY,
    hd: { number: 1, faces: 8 },
    proficiency: ['int', 'wis'],
    casterProgression: '1/3',
    spellcastingAbility: 'int',
    cantripProgression: Array(20).fill(2),
    classFeatures: [],
    classTableGroups: [
      {
        title: 'Spell Slots per Spell Level',
        colLabels: ['1st', '2nd'],
        rowsSpellProgression: ODD,
      },
    ],
  };
  const slotsOf = (e: Json) =>
    (e.classTableGroups as Json[]).find((g) => Array.isArray(g.rowsSpellProgression))
      ?.rowsSpellProgression as unknown[][] | undefined;
  /** Opened as the Workshop opens the stored entry. */
  const opened = () => {
    const registry = world({}, { class: [structuredClone(STORED)] });
    const e = registry.get('class', 'Lantern', 'MyHomebrew') as Json;
    return { registry, draft: openClass(structuredClone(e), { registry }) };
  };
  const save = (draft: Json, registry: EntityRegistry) =>
    writeClass({
      draft,
      source: 'MyHomebrew',
      mode: 'full',
      registry,
      stored: KEY,
      storedAs: [KEY],
    }).entry;

  it('keeps its slots when a count changes, and writes none of the draft its own', () => {
    const { registry, draft } = opened();
    const entry = save({ ...draft, cantripProgression: Array(20).fill(3) }, registry);
    expect(slotsOf(entry)).toEqual(ODD);
    expect(entry).not.toHaveProperty('_spellsOpened');
    expect(entry).not.toHaveProperty('_features');
  });

  it('makes its slots again for a new progression, the same on every save after', () => {
    const { registry, draft } = opened();
    const full = { ...draft, casterProgression: 'full' };
    const first = save(full, registry);
    expect(slotsOf(first)?.[2]).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
    // After a save the Workshop reads the registry again; the draft's table is as it opened.
    const refreshed = world({}, { class: [structuredClone(first)] });
    expect(slotsOf(save(full, refreshed))).toEqual(slotsOf(first));
  });

  it('shows the slots Save writes: its own until the progression changes, then the new ones', () => {
    const { registry, draft } = opened();
    const top = (d: Json) => spellColumns(d, () => undefined).find((c) => c.key === 'slot')?.values;
    // Its own table: a 1st-level slot at level 1, which 1/3 gives none of.
    expect(top(draft)?.[0]).toBe('1st');
    const full = { ...draft, casterProgression: 'full' };
    expect(top(full)?.[16]).toBe('9th');
    const first = save(full, registry);
    expect(slotsOf(first)?.[16]?.[8]).toBe(1);
    // After Save the draft is kept, its table as it opened: it still shows what was saved.
    const refreshed = world({}, { class: [structuredClone(first)] });
    const reopened = openClass(
      structuredClone(refreshed.get('class', 'Lantern', 'MyHomebrew') as Json),
      { registry: refreshed },
    );
    expect(top(full)).toEqual(top(reopened));
  });

  it('opened new, makes the slots its progression gives', () => {
    const registry = world();
    const draft = openClass({ name: 'Lantern', ...editor.blank() }, { registry });
    const { entry } = saveNew(
      { ...draft, casterProgression: 'full', spellcastingAbility: 'int' },
      registry,
    );
    expect(slotsOf(entry)?.[0]).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(entry).not.toHaveProperty('_spellsOpened');
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

describe("the book's own columns", () => {
  it('leaves out a slot table headed by spell levels alone, as the Spellcaster sidekick has', () => {
    const draft = {
      classTableGroups: [
        { colLabels: ['{@filter 1st|spells|level=1}', '2nd'], rows: [[2, 0]] },
        { colLabels: ['Psi Dice'], rows: [['d6']] },
      ],
    };
    expect(bookAt(draft)(1)).toEqual([['Psi Dice', 'd6']]);
  });
});
