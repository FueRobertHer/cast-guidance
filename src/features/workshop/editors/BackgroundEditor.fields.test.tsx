// @vitest-environment jsdom
// U5c (ADR-002, board 5): the background fields. A choice of skills, a choice
// of tools, languages by name, spells and what it does on the sheet: each
// edited as a player edits it, stored as Save stores it, read where the sheet
// reads it, and opened again unchanged.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { engineContextFor } from '@/data5e/engineAdapter';
import { EntityRegistry, mergeHomebrew } from '@/data5e/normalize';
import { deriveSheet, pendingChoices } from '@/engine/derive';
import { newCharacterDoc } from '@/engine/types';
import { makeTestContext } from '../../../../tests-fixtures/testWorld';
import { writeEntry } from '../copyWriter';
import type { Json } from '../editorTypes';
import { editor, grantedOf, grantedWith, TOOL_KINDS } from './BackgroundEditor';

afterEach(cleanup);

const ACOLYTE: Json = {
  name: 'Acolyte',
  source: 'TST',
  skillProficiencies: [{ insight: true, religion: true }],
  toolProficiencies: [{ "calligrapher's supplies": true }],
  languageProficiencies: [{ anyStandard: 2 }],
  entries: [],
};

/** The test world's spells and Acolyte, with `mine` as the player's book. */
function world(mine?: Json[]) {
  const registry = new EntityRegistry();
  registry.addAll('spell', makeTestContext().byType('spell') as Entity[]);
  registry.addAll('background', [structuredClone(ACOLYTE) as Entity]);
  if (mine !== undefined)
    mergeHomebrew(
      registry,
      new Map([['mine', { _meta: { sources: [{ json: 'HB' }] }, background: mine }]]),
      new Map(),
      new Set(),
    );
  return registry;
}

function mount(start: Json, original?: Json) {
  let latest = start;
  let changes = 0;
  const registry = world();
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

const save = (draft: Json, original?: Json) =>
  writeEntry({ original, draft, source: 'HB', mode: 'changes' });

function reopen(stored: Json) {
  cleanup();
  const at = mount(stored);
  expect(at.changes()).toBe(0);
  return at;
}

/** A level 3 Warrior from this background, and what they are asked. */
function hero(stored: Json) {
  const registry = world([structuredClone(stored)]);
  const d = newCharacterDoc('hero', 'Hero', 'test');
  d.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
  d.background = { name: String(stored.name), source: 'HB' };
  const ctx = engineContextFor(registry, {});
  return { sheet: deriveSheet(d, ctx), asked: pendingChoices(d, ctx) };
}

const NEW = { name: 'Wayfarer', ...editor.blank() };

describe('a proficiency list as names and one choice', () => {
  it('reads and writes each shape the data keys', () => {
    const skills = [{ insight: true, choose: { from: ['arcana', 'history'], count: 2 } }];
    expect(grantedOf(skills, 'any')).toEqual({
      names: ['insight'],
      choice: { count: 2, from: ['arcana', 'history'] },
    });
    expect(grantedWith(grantedOf(skills, 'any') as never, 'any')).toEqual(skills);
    expect(grantedOf([{ any: 2 }], 'any')).toEqual({ names: [], choice: { count: 2, from: [] } });
    expect(
      grantedWith({ names: [], choice: { count: 1, from: ['arcana', 'history'] } }, 'any'),
    ).toEqual([{ choose: { from: ['arcana', 'history'] } }]);
    const tools = [{ anyGamingSet: 1 }];
    expect(grantedOf(tools, 'any', TOOL_KINDS)).toEqual({
      names: [],
      choice: { count: 1, from: ['gaming set'] },
    });
    expect(grantedWith(grantedOf(tools, 'any', TOOL_KINDS) as never, 'any', TOOL_KINDS)).toEqual(
      tools,
    );
    // Two choices, or alternatives, are more than the field shows.
    expect(grantedOf([{ any: 1, choose: { from: ['arcana'] } }], 'any')).toBeUndefined();
    expect(grantedOf([{ insight: true }, { religion: true }], 'any')).toBeUndefined();
    expect(grantedOf(undefined, 'any')).toEqual({ names: [] });
  });
});

describe('background fields', () => {
  it('a choice of skills from a list saves, asks the player on the sheet, and opens unchanged', () => {
    const at = mount(structuredClone(NEW));
    chip('Skill proficiencies', 'Insight');
    type('Skills of your choice', '2');
    expect(at.draft().skillProficiencies).toEqual([{ insight: true, any: 2 }]);
    chip('Skills chosen from', 'Arcana');
    chip('Skills chosen from', 'History');
    chip('Skills chosen from', 'Nature');
    const stored = save(at.draft());
    expect(stored.skillProficiencies).toEqual([
      { insight: true, choose: { from: ['arcana', 'history', 'nature'], count: 2 } },
    ]);
    const { sheet, asked } = hero(stored);
    expect(sheet.skills.Insight?.prof).toBeGreaterThan(0);
    const pick = asked.find((p) => /skill/i.test(p.label) && p.count === 2);
    expect(pick?.options.map((o) => o.label.toLowerCase()).sort()).toEqual([
      'arcana',
      'history',
      'nature',
    ]);
    reopen(stored);
    expect(pressed('Skills chosen from', 'Nature')).toBe('true');
    expect(box('Skills of your choice')).toBe('2');
  });

  it('a choice of tools of a kind saves as that kind, and the sheet offers its tools', () => {
    const at = mount(structuredClone(NEW));
    type('Tools of your choice', '1');
    expect(at.draft().toolProficiencies).toEqual([{ any: 1 }]);
    type('Tools chosen from', 'gaming set');
    const stored = save(at.draft());
    expect(stored.toolProficiencies).toEqual([{ anyGamingSet: 1 }]);
    const { asked } = hero(stored);
    const pick = asked.find((p) => p.options.some((o) => /dice set/i.test(o.label)));
    expect(pick).toBeDefined();
    reopen(stored);
    expect(box('Tools chosen from')).toBe('gaming set');
  });

  it('keeps the list a choice is from while its count is retyped, and none once left empty', () => {
    const languages = [{ choose: { from: ['elvish', 'dwarvish', 'gnomish'] } }];
    const at = mount({ ...structuredClone(NEW), languageProficiencies: languages });
    type('Languages of your choice', '');
    expect(box('Languages of your choice')).toBe('');
    expect(at.draft().languageProficiencies).toEqual(languages);
    type('Languages of your choice', '2');
    expect(at.draft().languageProficiencies).toEqual([
      { choose: { from: ['elvish', 'dwarvish', 'gnomish'], count: 2 } },
    ]);
    type('Languages of your choice', '');
    fireEvent.blur(screen.getByLabelText('Languages of your choice'));
    expect(at.draft().languageProficiencies).toBeUndefined();
  });

  it('languages by name reach the Languages list, beside a choice of any', () => {
    const at = mount(structuredClone(NEW));
    type('Languages by name', 'Elvish, Dwarvish');
    type('Languages of your choice', '1');
    const stored = save(at.draft());
    expect(stored.languageProficiencies).toEqual([
      { elvish: true, dwarvish: true, anyStandard: 1 },
    ]);
    const { sheet, asked } = hero(stored);
    expect(sheet.languages).toEqual(expect.arrayContaining(['Elvish', 'Dwarvish']));
    expect(asked.some((p) => p.kind === 'language')).toBe(true);
    reopen(stored);
    expect(box('Languages by name')).toBe('elvish, dwarvish');
  });

  it('spells save from the character level they name, and are given on the sheet', () => {
    const at = mount(structuredClone(NEW));
    fireEvent.click(screen.getByRole('button', { name: 'Add a spell' }));
    type('Spell 1', 'Guidance');
    const stored = save(at.draft());
    expect(stored.additionalSpells).toEqual([{ known: { _: ['Guidance|TST'] } }]);
    const { sheet } = hero(stored);
    expect(sheet.grantedSpells.some((s) => s.name === 'Guidance' && s.origin === 'Wayfarer')).toBe(
      true,
    );
    reopen(stored);
    expect(box('Spell 1')).toBe('Guidance');
  });

  it("turning off what the book's background does turns off what its fields give", () => {
    const at = mount(structuredClone(ACOLYTE), ACOLYTE);
    expect(screen.getByText(/Turning off what Acolyte does below/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Also does what Acolyte does on the sheet/ }),
    );
    const stored: Json = { ...save({ ...at.draft(), name: 'Hermit' }, ACOLYTE), name: 'Hermit' };
    expect(stored.castGuidance).toMatchObject({ replace: true });
    const { sheet: off } = hero(stored);
    expect(off.skills.Insight?.prof).toBe(0);
    const { sheet: on } = hero({ ...stored, castGuidance: undefined });
    expect(on.skills.Insight?.prof).toBeGreaterThan(0);
  });
});

describe('a choice the Build tab can make', () => {
  it('a kind said with "a" or in capitals is that kind, which the sheet offers', () => {
    const one = (from: string[]) => ({ names: [], choice: { count: 1, from } });
    expect(grantedWith(one(['a gaming set']), 'any', TOOL_KINDS)).toEqual([{ anyGamingSet: 1 }]);
    expect(grantedWith(one(['Gaming Set']), 'any', TOOL_KINDS)).toEqual([{ anyGamingSet: 1 }]);
    // Beside a name, the kind is kept in the words the sheet reads.
    expect(grantedWith(one(["thieves' tools", 'A Gaming Set']), 'any', TOOL_KINDS)).toEqual([
      { choose: { from: ["thieves' tools", 'gaming set'] } },
    ]);
    const at = mount(structuredClone(NEW));
    type('Tools of your choice', '1');
    type('Tools chosen from', 'A gaming set');
    const stored = save(at.draft());
    expect(stored.toolProficiencies).toEqual([{ anyGamingSet: 1 }]);
    const { asked } = hero(stored);
    expect(asked.some((p) => p.options.some((o) => /dice set/i.test(o.label)))).toBe(true);
  });

  it('will not save more of a choice than it names, a kind naming many', () => {
    const with_ = (patch: Json) => editor.check?.({ ...structuredClone(NEW), ...patch });
    const choose = (from: string[], count: number) => [{ choose: { from, count } }];
    expect(with_({ skillProficiencies: choose(['arcana', 'history'], 3) })).toBe(
      'The skills of your choice are 3, from a list of 2. Name more, or choose fewer.',
    );
    expect(with_({ toolProficiencies: choose(["thieves' tools"], 2) })).toBe(
      'The tools of your choice are 2, from a list of 1. Name more, or choose fewer.',
    );
    expect(with_({ languageProficiencies: choose(['elvish'], 2) })).toBe(
      'The languages of your choice are 2, from a list of 1. Name more, or choose fewer.',
    );
    expect(with_({ skillProficiencies: choose(['arcana', 'history'], 2) })).toBeUndefined();
    expect(
      with_({ toolProficiencies: choose(['gaming set', "thieves' tools"], 3) }),
    ).toBeUndefined();
    // In the sheet's own words, in any letters; other words for a kind name one tool there.
    expect(
      with_({ toolProficiencies: choose(['Gaming Set', "thieves' tools"], 3) }),
    ).toBeUndefined();
    expect(with_({ toolProficiencies: choose(['a gaming set', "thieves' tools"], 3) })).toBe(
      'The tools of your choice are 3, from a list of 2. Name more, or choose fewer.',
    );
    // A kind is as many tools as the sheet offers of it.
    expect(with_({ toolProficiencies: [{ anyGamingSet: 9 }] })).toMatch(
      /^The tools of your choice are 9, from a list of \d+\./,
    );
    expect(with_({ toolProficiencies: [{ anyGamingSet: 2 }] })).toBeUndefined();
  });

  it('shows a skill the list has no chip for, to be seen and taken off', () => {
    const at = mount({
      ...structuredClone(NEW),
      skillProficiencies: [{ 'dream lore': true, choose: { from: ['arcana', 'star lore'] } }],
    });
    expect(pressed('Skill proficiencies', 'dream lore')).toBe('true');
    expect(pressed('Skills chosen from', 'star lore')).toBe('true');
    chip('Skill proficiencies', 'dream lore');
    chip('Skills chosen from', 'star lore');
    expect(at.draft().skillProficiencies).toEqual([{ choose: { from: ['arcana'] } }]);
  });

  it("shows a skill in other letters on the list's own chip, once", () => {
    const at = mount({ ...structuredClone(NEW), skillProficiencies: [{ Arcana: true }] });
    const group = screen.getByRole('group', { name: 'Skill proficiencies' });
    expect(within(group).getAllByRole('button', { name: 'Arcana' })).toHaveLength(1);
    expect(pressed('Skill proficiencies', 'Arcana')).toBe('true');
    chip('Skill proficiencies', 'Arcana');
    expect(at.draft().skillProficiencies).toBeUndefined();
  });

  it('a choice of any tool, or of tools named, is asked on the sheet', () => {
    const at = mount(structuredClone(NEW));
    type('Tools of your choice', '1');
    const any = save(at.draft());
    expect(any.toolProficiencies).toEqual([{ any: 1 }]);
    const anyPick = hero(any).asked.find((p) => p.options.some((o) => /dice set/i.test(o.label)));
    expect(anyPick?.options.some((o) => /thieves/i.test(o.label))).toBe(true);
    type('Tools chosen from', "thieves' tools, herbalism kit");
    const named = save(at.draft());
    expect(named.toolProficiencies).toEqual([
      { choose: { from: ["thieves' tools", 'herbalism kit'] } },
    ]);
    const namedPick = hero(named).asked.find((p) =>
      p.options.some((o) => /herbalism/i.test(o.label)),
    );
    expect(namedPick?.options).toHaveLength(2);
  });

  it('saves its own cards, read on the sheet', () => {
    const at = mount({
      ...structuredClone(NEW),
      castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: 1 }] },
    });
    const section = screen
      .getByRole('heading', { name: 'What it does on the sheet' })
      .closest('section');
    fireEvent.change(within(section as HTMLElement).getByLabelText('Armor Class: Amount'), {
      target: { value: '2' },
    });
    const stored = save(at.draft());
    expect(stored.castGuidance).toMatchObject({ effects: [{ kind: 'acBonus', amount: 2 }] });
    const { sheet } = hero(stored);
    expect(sheet.ac.parts.some((p) => p.label === 'Wayfarer' && p.amount === 2)).toBe(true);
  });
});
