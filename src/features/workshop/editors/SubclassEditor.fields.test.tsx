// @vitest-environment jsdom
// U5c (ADR-002, board 5): the subclass fields. Its own spellcasting and its
// table, the spells it gives by class level, and its effects: each saved as
// Save writes it, read on the sheet, and opened again unchanged. A copy whose
// feature a table's change placed reads and writes it against the feature
// below the change, as the merge resolves the copy (U10).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { engineContextFor } from '@/data5e/engineAdapter';
import { type EntityRegistry, mergeHomebrew, normalizeDataset } from '@/data5e/normalize';
import { deriveSheet } from '@/engine/derive';
import { newCharacterDoc } from '@/engine/types';
import { writeChange } from '../copyWriter';
import type { Json } from '../editorTypes';
import { editor, editsOf, featureTree, openSubclass, writeSubclass } from './SubclassEditor';

afterEach(cleanup);

const ref = (name: string, level: number) => `${name}|Fighter|XPHB|Knight|XPHB|${level}`;
const KNIGHT: Json = {
  name: 'Knight',
  shortName: 'Knight',
  source: 'XPHB',
  className: 'Fighter',
  classSource: 'XPHB',
  subclassFeatures: [ref('Knight', 3), ref('Bulwark', 15)],
};
const feature = (name: string, level: number, entries: unknown[]): Json => ({
  name,
  source: 'XPHB',
  className: 'Fighter',
  classSource: 'XPHB',
  subclassShortName: 'Knight',
  subclassSource: 'XPHB',
  level,
  entries,
});
const BOOK = {
  class: [
    { name: 'Fighter', source: 'XPHB', hd: { number: 1, faces: 10 }, classFeatures: [] },
    {
      name: 'Paladin',
      source: 'XPHB',
      hd: { number: 1, faces: 10 },
      casterProgression: '1/2',
      spellcastingAbility: 'cha',
      classFeatures: [],
    },
  ],
  subclass: [KNIGHT],
  subclassFeature: [
    feature('Knight', 3, ['You are a knight.']),
    feature('Bulwark', 15, ['Allies near you take less damage.']),
  ],
};
const SPELLS = [
  { name: 'Shield', source: 'XPHB', level: 1, school: 'A' },
  { name: 'Light', source: 'XPHB', level: 0, school: 'V' },
];

function world(changes: Record<string, Json[]> = {}, mine?: Record<string, unknown>) {
  const registry = normalizeDataset(
    new Map<string, unknown>([
      ['class/class-fighter.json', BOOK],
      ['spells/spells-xphb.json', { spell: SPELLS }],
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
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

/** Saved as a new subclass of the player's own. */
const saveNew = (
  draft: Json,
  registry: EntityRegistry,
  stored?: { name: string; source: string },
) => writeSubclass({ draft, source: 'MyHomebrew', mode: 'full', registry, stored });

/** A Fighter of `levels` with this subclass, as the sheet derives it. */
function sheetOf(registry: EntityRegistry, levels: number, name = 'Lantern') {
  const doc = newCharacterDoc('c', 'Hero', 't');
  doc.classes = [
    {
      ref: { name: 'Fighter', source: 'XPHB' },
      levels,
      hp: Array(levels).fill('avg'),
      subclass: { name, source: 'MyHomebrew' },
    },
  ];
  doc.abilities = { ...doc.abilities, base: { ...doc.abilities.base, int: 16 } };
  return deriveSheet(doc, engineContextFor(registry, {}));
}

const NEW: Json = { name: 'Lantern', className: 'Fighter', classSource: 'XPHB', ...editor.blank() };

describe('its own spellcasting and table', () => {
  it('casts for a class with none, its table saved for the subclass and read on the sheet', async () => {
    const registry = world();
    const at = mount(structuredClone(NEW), registry);
    type('Its own spellcasting', '1/3');
    expect(editor.check?.(at.draft())).toBe('Pick the ability it casts its spells with.');
    type('Casts with', 'int');
    fireEvent.change(screen.getByLabelText('Its spells'), { target: { value: 'known' } });
    fireEvent.change(await screen.findByLabelText('Known at level 1'), { target: { value: '3' } });
    expect(editor.check?.(at.draft())).toBeUndefined();
    const { entry } = saveNew(at.draft(), registry);
    expect(entry.casterProgression).toBe('1/3');
    const table = entry.subclassTableGroups as Json[];
    expect(
      table.every(
        (g) => JSON.stringify(g.subclasses) === '[{"name":"Lantern","source":"MyHomebrew"}]',
      ),
    ).toBe(true);
    expect(table.some((g) => Array.isArray(g.rowsSpellProgression))).toBe(true);
    const sheet = sheetOf(world({}, { subclass: [structuredClone(entry)] }), 3);
    const block = sheet.spellcasting[0];
    expect(block?.mode).toBe('known');
    expect(block?.slots[0]).toBe(2);
    expect(block?.spellsKnownMax).toBe(3);
    cleanup();
    const again = mount(openSubclass(structuredClone(entry), { registry }), registry);
    expect((screen.getByLabelText('Its own spellcasting') as HTMLSelectElement).value).toBe('1/3');
    expect(await screen.findByLabelText('Known at level 1')).toBeTruthy();
    expect(box('Known at level 1')).toBe('3');
    expect(again.changes()).toBe(0);
  });

  it('shows no table without spells of its own or a column of the book to show', async () => {
    const spellsOnly = [{ colLabels: ['Spells Known'], rows: [[3]] }];
    mount({ ...structuredClone(NEW), subclassTableGroups: spellsOnly }, world());
    expect(screen.queryByRole('list', { name: 'Lantern by level' })).toBeNull();
    cleanup();
    const dice = [{ colLabels: ['Psi Dice'], rows: [['d6']] }];
    mount({ ...structuredClone(NEW), subclassTableGroups: dice }, world());
    expect(await screen.findByRole('list', { name: 'Lantern by level' })).toBeTruthy();
  });

  it('says the class casts on its own, where the sheet reads the class', () => {
    mount({ ...structuredClone(NEW), className: 'Paladin' }, world());
    expect(screen.getByText(/Paladin casts spells of its own/)).toBeTruthy();
  });

  it("keeps the table it came with while its spellcasting is as it was, and shows the book's columns", async () => {
    const groups = [
      {
        subclasses: [{ name: 'Lantern', source: 'MyHomebrew' }],
        colLabels: ['Energy Dice'],
        rows: Array.from({ length: 20 }, (_, i) => [i < 2 ? 0 : 4]),
      },
    ];
    const stored = { ...structuredClone(NEW), source: 'MyHomebrew', subclassTableGroups: groups };
    const mine = world({}, { subclass: [structuredClone(stored)] });
    mount(structuredClone(stored), mine);
    fireEvent.click(await screen.findByRole('button', { name: /^Level 3,/ }));
    expect(screen.getByText(/The book's table at level 3: Energy Dice 4/)).toBeTruthy();
    const { entry } = saveNew(structuredClone(stored), mine, {
      name: 'Lantern',
      source: 'MyHomebrew',
    });
    expect(entry.subclassTableGroups).toEqual(groups);
  });
});

describe('its own slot table, saved again and again', () => {
  // A converted subclass's slots, from level 1: not what 1/3 gives, read first
  // by the sheet. Its table has no cantrips column, which a table made again would.
  const ODD = Array.from({ length: 20 }, (_, i) => (i < 6 ? [2] : [3, 1]));
  const KEY = { name: 'Lantern', source: 'MyHomebrew' };
  const STORED: Json = {
    ...structuredClone(NEW),
    source: 'MyHomebrew',
    casterProgression: '1/3',
    spellcastingAbility: 'int',
    cantripProgression: Array(20).fill(2),
    subclassTableGroups: [
      {
        subclasses: [KEY],
        title: 'Spell Slots per Spell Level',
        colLabels: ['1st', '2nd'],
        rowsSpellProgression: ODD,
      },
    ],
  };
  const slotsOf = (e: Json) =>
    (e.subclassTableGroups as Json[]).find((g) => Array.isArray(g.rowsSpellProgression))
      ?.rowsSpellProgression as unknown[][] | undefined;
  /** Opened as the Workshop opens the stored entry. */
  const opened = () => {
    const registry = world({}, { subclass: [structuredClone(STORED)] });
    const e = registry.get('subclass', 'Lantern', 'MyHomebrew') as Json;
    return { registry, draft: openSubclass(structuredClone(e), { registry }) };
  };
  const save = (draft: Json, registry: EntityRegistry, storedAs = [KEY]) =>
    writeSubclass({
      draft,
      source: 'MyHomebrew',
      mode: 'full',
      registry,
      stored: storedAs.at(-1),
      storedAs,
    }).entry;

  it('keeps its slots when a count changes', () => {
    const { registry, draft } = opened();
    const entry = save({ ...draft, cantripProgression: Array(20).fill(3) }, registry);
    expect(slotsOf(entry)).toEqual(ODD);
    expect((entry.subclassTableGroups as Json[])[0]?.rows).toEqual(
      Array.from({ length: 20 }, () => [3]),
    );
    expect(
      sheetOf(world({}, { subclass: [structuredClone(entry)] }), 1).spellcasting[0]?.slots[0],
    ).toBe(2);
  });

  it('makes its slots again for a new progression, the same on every save after', () => {
    const { registry, draft } = opened();
    const full = { ...draft, casterProgression: 'full' };
    const first = save(full, registry);
    expect(slotsOf(first)?.[2]).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
    // After a save the Workshop reads the registry again; the draft's table is as it opened.
    const refreshed = world({}, { subclass: [structuredClone(first)] });
    expect(slotsOf(save(full, refreshed))).toEqual(slotsOf(first));
  });

  it('keeps its table under a new name', () => {
    const { registry, draft } = opened();
    const renamed: Json = { ...draft, name: 'Lamplight' };
    const both = [KEY, { name: 'Lamplight', source: 'MyHomebrew' }];
    expect(save(renamed, registry, both).subclassTableGroups).toEqual(STORED.subclassTableGroups);
  });
});

describe('the spells it gives', () => {
  it('saves them by class level from its first, read on the sheet, and opens them unchanged', () => {
    const registry = world();
    const at = mount(structuredClone(NEW), registry);
    press('Add spells at a level');
    expect(box('Spell row 1: from level')).toBe('3');
    type('Spell row 1: spells', 'Shield');
    expect(at.draft().additionalSpells).toEqual([{ prepared: { '3': ['Shield|XPHB'] } }]);
    const { entry } = saveNew(
      { ...at.draft(), casterProgression: '1/3', spellcastingAbility: 'int' },
      registry,
    );
    const sheet = sheetOf(world({}, { subclass: [structuredClone(entry)] }), 3);
    expect(sheet.grantedSpells.find((s) => s.name === 'Shield')?.usage).toBe('prepared');
    cleanup();
    const again = mount(openSubclass(structuredClone(entry), { registry }), registry);
    expect(box('Spell row 1: spells')).toBe('Shield');
    expect(again.changes()).toBe(0);
  });

  it('waits for the next digit when a level is retyped', () => {
    const at = mount(structuredClone(NEW), world());
    press('Add spells at a level');
    type('Spell row 1: spells', 'Shield');
    type('Spell row 1: from level', '');
    // Emptied, the box stays empty and the row keeps its level, so 5 is 5, not 15.
    expect(box('Spell row 1: from level')).toBe('');
    expect(at.draft().additionalSpells).toEqual([{ prepared: { '3': ['Shield|XPHB'] } }]);
    type('Spell row 1: from level', '5');
    expect(box('Spell row 1: from level')).toBe('5');
    expect(at.draft().additionalSpells).toEqual([{ prepared: { '5': ['Shield|XPHB'] } }]);
    // 0 is no level: held, not saved, and the level it had is back once left.
    type('Spell row 1: from level', '0');
    expect(at.draft().additionalSpells).toEqual([{ prepared: { '5': ['Shield|XPHB'] } }]);
    fireEvent.blur(screen.getByLabelText('Spell row 1: from level'));
    expect(box('Spell row 1: from level')).toBe('5');
    type('Spell row 1: from level', '25');
    expect(at.draft().additionalSpells).toEqual([{ prepared: { '20': ['Shield|XPHB'] } }]);
  });

  it('keeps the cantrips it knows beside the list, and says so', () => {
    const registry = world();
    const start = {
      ...structuredClone(NEW),
      additionalSpells: [{ known: { '3': ['light|xphb#c'] }, prepared: { '3': ['shield|xphb'] } }],
    };
    const at = mount(start, registry);
    expect(screen.getByText(/the spells it knows, kept as written/)).toBeTruthy();
    press('Add spells at a level');
    type('Spell row 2: spells', 'Light');
    expect(at.draft().additionalSpells).toEqual([
      { known: { '3': ['light|xphb#c'] }, prepared: { '3': ['shield|xphb'], '5': ['Light|XPHB'] } },
    ]);
  });
});

describe('what the whole subclass does on the sheet', () => {
  it('saves its own cards, counted from its first level', () => {
    const registry = world();
    const at = mount(
      {
        ...structuredClone(NEW),
        castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: 1 }] },
      },
      registry,
    );
    const section = screen
      .getByRole('heading', { name: 'What it does on the sheet' })
      .closest('section');
    fireEvent.change(within(section as HTMLElement).getByLabelText('Armor Class: Amount'), {
      target: { value: '2' },
    });
    const { entry } = saveNew(at.draft(), registry);
    expect(entry.castGuidance).toMatchObject({ effects: [{ kind: 'acBonus', amount: 2 }] });
    const sheet = sheetOf(world({}, { subclass: [structuredClone(entry)] }), 3);
    expect(sheet.ac.parts.some((p) => p.label === 'Lantern' && p.amount === 2)).toBe(true);
  });
});

describe('a copy of a subclass whose feature a table changed (U10)', () => {
  const bulwarkChange = () => {
    const base = normalizeDataset(new Map([['class/class-fighter.json', BOOK]]));
    const bulwark = base.get('subclassFeature', 'Bulwark', 'XPHB') as Json;
    return [
      writeChange('subclassFeature', bulwark, {
        ...bulwark,
        entries: ['Allies take none.'],
      }) as Entity,
    ];
  };
  const tableWorld = (mine?: Record<string, unknown>) =>
    world({ subclassFeature: bulwarkChange() }, mine);

  function renamed(entries?: unknown[]) {
    const registry = tableWorld();
    const sub = registry.get('subclass', 'Knight', 'XPHB') as Json;
    const node = featureTree(sub, registry).find((n) => n.entity?.name === 'Bulwark');
    if (node === undefined) throw new Error('no Bulwark');
    expect(node.base.entries).toEqual(['Allies take none.']);
    const draft = openSubclass(structuredClone(sub), { original: sub, registry });
    draft.name = 'Lantern';
    draft._features = {
      ...editsOf(draft),
      changed: { [node.ref]: { ...node.base, name: 'Rampart', ...(entries ? { entries } : {}) } },
    };
    const written = writeSubclass({
      original: sub,
      copied: sub,
      draft,
      source: 'MyHomebrew',
      mode: 'changes',
      registry,
    });
    const file = {
      subclass: [structuredClone(written.entry)],
      subclassFeature: structuredClone(written.owned),
    };
    return { written, file, loaded: tableWorld(structuredClone(file)), ref: node.ref };
  }

  it("keeps the table's change in the copy, as the sheet resolves it", () => {
    const { loaded } = renamed();
    expect(loaded.get('subclassFeature', 'Rampart', 'MyHomebrew')?.entries).toEqual([
      'Allies take none.',
    ]);
  });

  it('reads a copy that went back to the book below the change as the book, not the table', () => {
    const { written, file, loaded, ref: at } = renamed(['Allies near you take less damage.']);
    expect(loaded.get('subclassFeature', 'Rampart', 'MyHomebrew')?.entries).toEqual([
      'Allies near you take less damage.',
    ]);
    const sub = loaded.get('subclass', 'Knight', 'XPHB') as Json;
    const draft = openSubclass(structuredClone(written.entry), {
      original: sub,
      registry: loaded,
      file: { _meta: {}, ...file },
    });
    expect(editsOf(draft).changed[at]?.entries).toEqual(['Allies near you take less damage.']);
  });
});
