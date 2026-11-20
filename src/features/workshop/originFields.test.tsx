// @vitest-environment jsdom
// U5b (ADR-002, board 5): the fields the species, feat, optional feature and
// item editors add. Each is edited as a player edits it, stored as Save
// stores it (`writeEntry`), counted where the sheet reads it, and opened again
// unchanged. A shape a field cannot show is kept, and stays as it was when
// another field is edited.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { EntityRegistry } from '@/data5e/normalize';
import { deriveSheet, pendingChoices } from '@/engine/derive';
import { featChoiceOption, type PrereqContext } from '@/engine/effects/prerequisites';
import { type CharacterDoc, type DataEntity, newCharacterDoc } from '@/engine/types';
import { headerFacts } from '@/features/library/fmt';
import { worldWith } from '../../../tests-fixtures/cardSheet';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { readStored, writeEntry } from './copyWriter';
import { editor as feat } from './editors/FeatEditor';
import { editor as item } from './editors/ItemEditor';
import { editor as optional } from './editors/OptionalFeatureEditor';
import { editor as species } from './editors/SpeciesEditor';
import { editor as subrace } from './editors/SubraceEditor';
import type { EditorSpec, Json } from './editorTypes';
import { grantRows, grantsOf } from './originFields';

afterEach(cleanup);

type Extra = Partial<Record<Parameters<EntityRegistry['addAll']>[0], Json[]>>;

/** The test world's spells, and `extra`'s entries by type. */
function withEntries(extra: Extra) {
  const registry = new EntityRegistry();
  registry.addAll('spell', makeTestContext().byType('spell') as Entity[]);
  for (const [t, list] of Object.entries(extra))
    registry.addAll(t as keyof Extra, (list ?? []) as Entity[]);
  return registry;
}

/** The editor on screen with the test world's spells; the draft as it stands, and how often it changed. */
function mount(spec: EditorSpec, start: Json, original?: Json, extra: Extra = {}) {
  let latest = start;
  let changes = 0;
  const registry = withEntries(extra);
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
      <spec.Body
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
const pick = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const box = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
const chip = (group: string, name: string) =>
  fireEvent.click(within(screen.getByRole('group', { name: group })).getByRole('button', { name }));
const pressed = (group: string, name: string) =>
  within(screen.getByRole('group', { name: group }))
    .getByRole('button', { name })
    .getAttribute('aria-pressed');

/** Save, as the Workshop stores a new entry in the player's book. */
const save = (draft: Json) => writeEntry({ draft, source: 'HB', mode: 'changes' });

/** Opened again from what was stored: nothing is written until a box is changed. */
function reopen(spec: EditorSpec, stored: Json) {
  cleanup();
  const at = mount(spec, stored);
  expect(at.changes()).toBe(0);
  return at;
}

/** A level 5 Warrior with what `setup` gives them, and what they are asked. */
function hero(setup: (d: CharacterDoc) => void, extra: Record<string, DataEntity[]>) {
  const d = newCharacterDoc('hero', 'Hero', 'test');
  d.abilities.base = { str: 14, dex: 16, con: 14, int: 10, wis: 12, cha: 10 };
  d.classes = [
    { ref: { name: 'Warrior', source: 'TST' }, levels: 5, hp: ['avg', 'avg', 'avg', 'avg', 'avg'] },
  ];
  setup(d);
  const ctx = worldWith(extra);
  return { sheet: deriveSheet(d, ctx), asked: pendingChoices(d, ctx) };
}

const asSpecies = (e: Json) =>
  hero(
    (d) => {
      d.race = { name: String(e.name), source: String(e.source) };
    },
    { race: [e as DataEntity] },
  );
const asFeat = (e: Json) =>
  hero(
    (d) => {
      d.feats = [{ ref: { name: String(e.name), source: String(e.source) }, instanceId: 'f0' }];
    },
    { feat: [e as DataEntity] },
  );

const NEW_SPECIES = { name: 'Lanternfolk', size: ['M'], speed: 30, entries: [] };

describe('species fields', () => {
  it('sizes Huge, Gargantuan and Varies save, read back, and show in the Library', () => {
    const at = mount(species, NEW_SPECIES);
    chip('Size', 'Medium');
    chip('Size', 'Huge');
    chip('Size', 'Gargantuan');
    const stored = save(at.draft());
    expect(stored.size).toEqual(['H', 'G']);
    expect(headerFacts('race', stored as Entity)).toContainEqual(['Size', 'H, G']);
    const again = reopen(species, stored);
    expect(pressed('Size', 'Huge')).toBe('true');
    expect(pressed('Size', 'Medium')).toBe('false');
    chip('Size', 'Varies');
    expect(again.draft().size).toEqual(['V']);
    expect(headerFacts('race', save(again.draft()) as Entity)).toContainEqual(['Size', 'V']);
  });

  it('fly, swim and climb speeds save as a speed block, count, and go back to a number', () => {
    const at = mount(species, NEW_SPECIES);
    type('Fly speed', '30');
    type('Swim speed', '25');
    const stored = save(at.draft());
    expect(stored.speed).toEqual({ walk: 30, fly: 30, swim: 25 });
    const { sheet } = asSpecies(stored);
    expect(sheet.otherSpeeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: 'fly', value: 30 }),
        expect.objectContaining({ mode: 'swim', value: 25 }),
      ]),
    );
    expect(sheet.speedWalk.value).toBe(30);
    const again = reopen(species, stored);
    expect(box('Fly speed')).toBe('30');
    type('Fly speed', '');
    type('Swim speed', '');
    expect(again.draft().speed).toBe(30);
  });

  it('a speed taken out again leaves a copy with no change to it', () => {
    const original = makeTestContext().get('race', 'Testfolk', 'TST') as Json;
    const at = mount(species, structuredClone(original), original);
    type('Climb speed', '20');
    type('Climb speed', '');
    const stored = writeEntry({ original, draft: at.draft(), source: 'HB', mode: 'changes' });
    expect(stored).not.toHaveProperty('speed');
    // An original whose speed is a block keeps it one.
    cleanup();
    const blocked = { ...original, speed: { walk: 30 } };
    const again = mount(species, structuredClone(blocked), blocked);
    type('Climb speed', '20');
    type('Climb speed', '');
    expect(again.draft().speed).toEqual({ walk: 30 });
    expect(
      writeEntry({ original: blocked, draft: again.draft(), source: 'HB', mode: 'changes' }),
    ).not.toHaveProperty('speed');
  });

  it('keeps a speed "as fast as walking" until a number is typed', () => {
    const at = mount(species, { ...NEW_SPECIES, speed: { walk: 30, swim: true } });
    expect((screen.getByLabelText('Swim speed') as HTMLInputElement).placeholder).toBe(
      'As walking',
    );
    type('Fly speed', '10');
    expect(at.draft().speed).toEqual({ walk: 30, swim: true, fly: 10 });
  });

  it('blindsight saves and counts beside darkvision', () => {
    const at = mount(species, NEW_SPECIES);
    type('Darkvision in feet', '60');
    type('Blindsight in feet', '10');
    const stored = save(at.draft());
    expect(stored).toMatchObject({ darkvision: 60, blindsight: 10 });
    expect(asSpecies(stored).sheet.senses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sense: 'darkvision', range: 60 }),
        expect.objectContaining({ sense: 'blindsight', range: 10 }),
      ]),
    );
    reopen(species, stored);
    expect(box('Blindsight in feet')).toBe('10');
  });

  it('ability scores save as fixed amounts and a choice, count, and ask the choice', () => {
    const at = mount(species, NEW_SPECIES);
    type('Strength +', '2');
    type('Abilities of their choice', '1');
    const stored = save(at.draft());
    expect(stored.ability).toEqual([{ str: 2, choose: { count: 1 } }]);
    const { sheet, asked } = asSpecies(stored);
    expect(sheet.abilities.str.value).toBe(16);
    expect(asked.map((p) => p.kind)).toContain('ability');
    reopen(species, stored);
    expect(box('Strength +')).toBe('2');
    expect(box('Each raised by')).toBe('1');
  });

  it('keeps an ability block it cannot show as it was, while another field changes', () => {
    const ability = [{ choose: { weighted: { from: ['str', 'dex'], weights: [2, 1] } } }];
    const at = mount(species, { ...NEW_SPECIES, ability });
    expect(screen.getByText(/a choice, kept as it is/)).toBeTruthy();
    type('Fly speed', '30');
    expect(at.draft().ability).toBe(ability);
  });

  it('immunities, vulnerabilities and conditions save and count', () => {
    const at = mount(species, NEW_SPECIES);
    chip('Immunities', 'Poison');
    chip('Vulnerabilities', 'Cold');
    chip('Conditions they cannot have', 'Charmed');
    const stored = save(at.draft());
    expect(stored).toMatchObject({
      immune: ['poison'],
      vulnerable: ['cold'],
      conditionImmune: ['charmed'],
    });
    const { sheet } = asSpecies(stored);
    expect(sheet.immunities.map((x) => x.damageType)).toContain('poison');
    expect(sheet.vulnerabilities.map((x) => x.damageType)).toContain('cold');
    expect(sheet.conditionImmunities.map((x) => x.condition)).toContain('charmed');
    reopen(species, stored);
    expect(pressed('Conditions they cannot have', 'Charmed')).toBe('true');
  });

  it('skills, tools, weapons and armor save and count, with a skill of their choice asked', () => {
    const at = mount(species, NEW_SPECIES);
    chip('Skills', 'Stealth');
    type('Skills of their choice', '1');
    type('Tools', "thieves' tools");
    type('Weapons', 'longsword, shortbow');
    chip('Armor', 'Light');
    const stored = save(at.draft());
    expect(stored).toMatchObject({
      skillProficiencies: [{ stealth: true, any: 1 }],
      toolProficiencies: [{ "thieves' tools": true }],
      weaponProficiencies: [{ longsword: true, shortbow: true }],
      armorProficiencies: [{ light: true }],
    });
    const { sheet, asked } = asSpecies(stored);
    expect(sheet.skills.Stealth?.prof).toBe(1);
    expect(sheet.toolProfs.map((t) => t.toLowerCase())).toContain("thieves' tools");
    expect(sheet.weaponProfs.map((t) => t.toLowerCase())).toEqual(
      expect.arrayContaining(['longsword', 'shortbow']),
    );
    expect(sheet.armorProfs.map((t) => t.toLowerCase())).toContain('light');
    expect(asked.map((p) => p.kind)).toContain('skill');
    reopen(species, stored);
    expect(box('Weapons')).toBe('longsword, shortbow');
    expect(box('Skills of their choice')).toBe('1');
  });

  it('a tap keeps the keys a list had in their place, and a name the chips lack', () => {
    const skills = [{ Perception: true, any: 1, 'arcane lore': true }];
    const at = mount(species, { ...NEW_SPECIES, skillProficiencies: skills });
    expect(pressed('Skills', 'Perception')).toBe('true');
    expect(screen.getByText(/also arcane lore, kept as written/)).toBeTruthy();
    chip('Skills', 'Stealth');
    expect(Object.keys((at.draft().skillProficiencies as Json[])[0] ?? {})).toEqual([
      'Perception',
      'any',
      'arcane lore',
      'stealth',
    ]);
  });

  it('keeps a choice of skills as it was', () => {
    const skills = [{ choose: { from: ['athletics', 'stealth'], count: 1 } }];
    const at = mount(species, { ...NEW_SPECIES, skillProficiencies: skills });
    chip('Armor', 'Light');
    expect(at.draft().skillProficiencies).toBe(skills);
  });

  it('languages save and count, with one of their choice asked', () => {
    const at = mount(species, NEW_SPECIES);
    chip('Languages', 'Common');
    chip('Languages', 'Elvish');
    type('Languages of their choice', '1');
    const stored = save(at.draft());
    expect(stored.languageProficiencies).toEqual([{ common: true, elvish: true, anyStandard: 1 }]);
    const { sheet, asked } = asSpecies(stored);
    expect(sheet.languages).toEqual(expect.arrayContaining(['Common', 'Elvish']));
    expect(asked.map((p) => p.kind)).toContain('language');
    reopen(species, stored);
    expect(pressed('Languages', 'Elvish')).toBe('true');
  });

  it('spells save by name and book, each from its level, and are given on the sheet', () => {
    const at = mount(species, NEW_SPECIES);
    fireEvent.click(screen.getByRole('button', { name: 'Add a spell' }));
    type('Spell 1', 'guidance');
    fireEvent.click(screen.getByRole('button', { name: 'Add a spell' }));
    type('Spell 2', 'Aid');
    pick('Spell 2: how', 'daily');
    type('Spell 2: from level', '3');
    pick('Their attack and DC from', 'wis');
    const stored = save(at.draft());
    expect(stored.additionalSpells).toEqual([
      {
        ability: 'wis',
        innate: { '3': { daily: { '1e': ['Aid|TST'] } } },
        known: { _: ['Guidance|TST'] },
      },
    ]);
    const { sheet } = asSpecies(stored);
    const given = sheet.grantedSpells.filter((s) => s.origin === 'Lanternfolk');
    expect(given.map((s) => s.name)).toEqual(expect.arrayContaining(['Guidance', 'Aid']));
    expect(given.find((s) => s.name === 'Aid')?.resourceKey).toBeDefined();
    reopen(species, stored);
    expect(box('Spell 2')).toBe('Aid');
    expect(box('Spell 2: from level')).toBe('3');
  });

  it('two spells a rest are two counts, each its own', () => {
    const rows = [
      { spell: 'Aid|TST', how: 'daily' as const, uses: 1, level: '_' },
      { spell: 'Guidance|TST', how: 'daily' as const, uses: 1, level: '_' },
    ];
    const raw = grantsOf(rows, undefined);
    expect(raw).toEqual([{ innate: { _: { daily: { '1e': ['Aid|TST', 'Guidance|TST'] } } } }]);
    const { sheet } = asSpecies({ ...NEW_SPECIES, source: 'HB', additionalSpells: raw });
    const keys = sheet.grantedSpells
      .filter((s) => s.origin === 'Lanternfolk')
      .map((s) => s.resourceKey);
    expect(new Set(keys).size).toBe(2);
    // A shared count ("1" for two spells) is one pool the rows cannot show.
    expect(grantRows([{ innate: { _: { daily: { '1': ['a', 'b'] } } } }])).toBeUndefined();
    // One spell alone under "1" keeps its key.
    const one = [{ innate: { _: { daily: { '1': ['aid|tst'] } } } }];
    expect(grantsOf(grantRows(one)?.rows ?? [], undefined)).toEqual(one);
  });

  it('keeps alternatives of spells as they were', () => {
    const spells = [
      { name: 'A', known: { _: ['light'] } },
      { name: 'B', known: { _: ['guidance'] } },
    ];
    const at = mount(species, { ...NEW_SPECIES, additionalSpells: spells });
    expect(screen.getByText(/alternatives or a choice of spell, kept/)).toBeTruthy();
    type('Fly speed', '30');
    expect(at.draft().additionalSpells).toBe(spells);
  });
});

const NEW_FEAT = { name: 'Harbour Hand', category: 'G', entries: ['A feat.'] };

describe('feat fields', () => {
  it('skills, tools and languages save and count', () => {
    const at = mount(feat, NEW_FEAT);
    chip('Skills', 'Perception');
    type('Tools', "navigator's tools");
    type('Languages of their choice', '2');
    const stored = save(at.draft());
    expect(stored).toMatchObject({
      skillProficiencies: [{ perception: true }],
      toolProficiencies: [{ "navigator's tools": true }],
      languageProficiencies: [{ anyStandard: 2 }],
    });
    const { sheet, asked } = asFeat(stored);
    expect(sheet.skills.Perception?.prof).toBe(1);
    expect(sheet.toolProfs.map((t) => t.toLowerCase())).toContain("navigator's tools");
    expect(asked.find((p) => p.kind === 'language')?.count).toBe(2);
    reopen(feat, stored);
    expect(box('Languages of their choice')).toBe('2');
  });

  it('weapon and armor training save and count', () => {
    const at = mount(feat, NEW_FEAT);
    type('Weapons', 'martial');
    chip('Armor', 'Shields');
    const stored = save(at.draft());
    expect(stored).toMatchObject({
      weaponProficiencies: [{ martial: true }],
      armorProficiencies: [{ shield: true }],
    });
    const { sheet } = asFeat(stored);
    expect(sheet.armorProfs.map((t) => t.toLowerCase())).toContain('shield');
    expect(sheet.weaponProfs.map((t) => t.toLowerCase())).toContain('martial');
    reopen(feat, stored);
    expect(pressed('Armor', 'Shields')).toBe('true');
  });

  it('expertise saves as a skill and a choice among proficient ones, and counts', () => {
    const at = mount(feat, { ...NEW_FEAT, skillProficiencies: [{ stealth: true }] });
    chip('Expertise', 'Stealth');
    type('Expertise in skills of their choice', '1');
    const stored = save(at.draft());
    expect(stored.expertise).toEqual([{ stealth: true, anyProficientSkill: 1 }]);
    const { sheet, asked } = asFeat(stored);
    expect(sheet.skills.Stealth?.prof).toBe(2);
    expect(asked.map((p) => p.kind)).toContain('expertise');
    reopen(feat, stored);
    expect(pressed('Expertise', 'Stealth')).toBe('true');
  });

  it('spells save and are given on the sheet', () => {
    const at = mount(feat, NEW_FEAT);
    fireEvent.click(screen.getByRole('button', { name: 'Add a spell' }));
    type('Spell 1', 'Guidance');
    pick('Spell 1: how', 'will');
    const stored = save(at.draft());
    expect(stored.additionalSpells).toEqual([{ innate: { _: { will: ['Guidance|TST'] } } }]);
    const given = asFeat(stored).sheet.grantedSpells.filter((s) => s.origin === 'Harbour Hand');
    expect(given.map((s) => s.name)).toEqual(['Guidance']);
    reopen(feat, stored);
    expect((screen.getByLabelText('Spell 1: how') as HTMLSelectElement).value).toBe('will');
  });

  it("a benefit's cards save in the benefit and count for the feat", () => {
    const sea = {
      type: 'entries',
      name: 'Sea Legs',
      entries: ['Steady on deck.'],
      castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: 1 }] },
    };
    const at = mount(feat, { ...NEW_FEAT, entries: ['A feat.', sea] });
    const row = within(screen.getByRole('list', { name: 'Benefits' }));
    expect(row.getByText('What it does on the sheet')).toBeTruthy();
    const stored = save(at.draft());
    expect((stored.entries as Json[])[1]).toEqual(sea);
    const without = asFeat(save({ ...NEW_FEAT, entries: ['A feat.'] })).sheet.ac.value;
    expect(asFeat(stored).sheet.ac.value).toBe(without + 1);
    reopen(feat, stored);
  });

  it("a copy's benefits offer no inherited part: the feat inherits as a whole", () => {
    const book = {
      ...NEW_FEAT,
      source: 'TST',
      entries: [{ type: 'entries', name: 'Sea Legs', entries: ['x'] }],
    };
    mount(feat, structuredClone(book), book);
    const modes = screen.getByRole('group', { name: 'Sea Legs: keep, change or remove' });
    fireEvent.click(within(modes).getByText('Change'));
    expect(
      within(screen.getByRole('list', { name: 'Benefits' })).getByText('What it does on the sheet'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('list', { name: 'Benefits' })).queryByText(/Also does what/),
    ).toBeNull();
  });

  it('senses save as feet and count', () => {
    const at = mount(feat, NEW_FEAT);
    type('Darkvision in feet', '60');
    type('Tremorsense in feet', '10');
    const stored = save(at.draft());
    expect(stored.senses).toEqual([{ darkvision: 60, tremorsense: 10 }]);
    expect(asFeat(stored).sheet.senses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sense: 'darkvision', range: 60 }),
        expect.objectContaining({ sense: 'tremorsense', range: 10 }),
      ]),
    );
    reopen(feat, stored);
    expect(box('Tremorsense in feet')).toBe('10');
  });

  it('prerequisites beyond level save, read back, and show in the feat lists', () => {
    const at = mount(feat, NEW_FEAT);
    type('Character level needed', '4');
    pick('Ability score needed', 'str');
    type('At least', '15');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Can cast at least one spell' }));
    type('Species', 'Elf, Dwarf');
    type('Feat', 'Tough|TST');
    pick('Armor training', 'medium');
    type('Something else, in words', 'A ship of your own');
    const stored = save(at.draft());
    expect(stored.prerequisite).toEqual([
      {
        level: 4,
        ability: [{ str: 15 }],
        spellcasting: true,
        race: [{ name: 'Elf' }, { name: 'Dwarf' }],
        feat: ['Tough|TST'],
        proficiency: [{ armor: 'medium' }],
        other: 'A ship of your own',
      },
    ]);
    const ctx: PrereqContext = {
      abilityScores: { str: 14, dex: 16, con: 14, int: 10, wis: 12, cha: 10 },
      totalLevel: 5,
      raceName: 'elf',
      featNames: new Set(['tough']),
      proficiencies: new Set(),
      armorProfs: new Set(['medium']),
      weaponProfs: new Set(),
      hasSpellcasting: true,
    };
    const option = featChoiceOption(stored as DataEntity, ctx);
    expect(option.description).toMatch(
      /^Prereq: STR 15, level 4, race Elf\/Dwarf, Tough feat, medium armor, A ship of your own, spellcasting\./,
    );
    // Strength 14 is short of 15: the list warns, and lets them take it.
    expect(option.advisory).toBe('You may not meet this prerequisite.');
    expect(
      featChoiceOption(stored as DataEntity, {
        ...ctx,
        abilityScores: { ...ctx.abilityScores, str: 15 },
      }).advisory,
    ).toBeUndefined();
    reopen(feat, stored);
    expect(box('Species')).toBe('Elf, Dwarf');
    expect((screen.getByLabelText('Armor training') as HTMLSelectElement).value).toBe('medium');
  });

  it('keeps prerequisites it cannot show as they were', () => {
    const pre = [{ ability: [{ str: 13 }, { dex: 13 }], campaign: ['Eberron'] }];
    const at = mount(feat, { ...NEW_FEAT, prerequisite: pre });
    expect(screen.getByText(/Also needs/).closest('p')?.textContent).toBe(
      'Also needs: an ability score, a campaign, kept as it is.',
    );
    type('Character level needed', '4');
    expect(at.draft().prerequisite).toEqual([{ ...pre[0], level: 4 }]);
    cleanup();
    const alternatives = [
      { level: 4, race: [{ name: 'elf' }] },
      { level: 4, feat: ['x'] },
    ];
    const at2 = mount(feat, { ...NEW_FEAT, prerequisite: alternatives });
    expect(screen.queryByLabelText('Species')).toBeNull();
    chip('Armor', 'Light');
    expect(at2.draft().prerequisite).toBe(alternatives);
  });
});

describe('optional feature fields', () => {
  it('a pact and a spell known save, and show in the class pick', () => {
    const at = mount(optional, {
      name: 'Harbour Blade',
      featureType: ['FS:T'],
      entries: ['A style.'],
    });
    pick('Pact boon', 'Blade');
    type('Spell known', 'Eldritch Blast#c');
    const stored = save(at.draft());
    expect(stored.prerequisite).toEqual([{ pact: 'Blade', spell: ['Eldritch Blast#c'] }]);
    const { asked } = hero(() => {}, { optionalfeature: [stored as DataEntity] });
    const option = asked.flatMap((p) => p.options).find((o) => o.id === 'harbour blade|hb');
    expect(option?.description).toMatch(/^Prereq: Pact of the Blade, knows Eldritch Blast\./);
    reopen(optional, stored);
    expect((screen.getByLabelText('Pact boon') as HTMLSelectElement).value).toBe('Blade');
    expect(box('Spell known')).toBe('Eldritch Blast#c');
  });
});

const NEW_ITEM = { name: 'Lamp of the Coast', type: 'W', rarity: 'uncommon', entries: ['A lamp.'] };

describe('item fields', () => {
  it('spells it casts at will and a number a rest save, and are given while it is carried', () => {
    const at = mount(item, { ...NEW_ITEM, attachedSpells: { charges: { '1': ['aid|tst'] } } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a spell' }));
    type('Spell 1', 'guidance');
    fireEvent.click(screen.getByRole('button', { name: 'Add a spell' }));
    type('Spell 2', 'aid');
    pick('Spell 2: how', 'rest');
    type('Spell 2: times', '2');
    const stored = save(at.draft());
    expect(stored.attachedSpells).toEqual({
      charges: { '1': ['aid|tst'] },
      will: ['Guidance|TST'],
      rest: { '2e': ['Aid|TST'] },
    });
    const { sheet } = hero(
      (d) => {
        d.equipment = [
          {
            id: 'i1',
            ref: { name: 'Lamp of the Coast', source: 'HB' },
            qty: 1,
            equipped: true,
            attuned: false,
          },
        ];
      },
      { item: [stored as DataEntity] },
    );
    const given = sheet.grantedSpells.filter((s) => s.origin === 'Lamp of the Coast');
    expect(given.map((s) => s.name)).toEqual(expect.arrayContaining(['Guidance', 'Aid']));
    reopen(item, stored);
    expect(box('Spell 2: times')).toBe('2');
    expect((screen.getByLabelText('Spell 2: how') as HTMLSelectElement).value).toBe('rest');
  });

  it('a copy saves the spells it changes, over the original it is read with', () => {
    const original = { ...NEW_ITEM, source: 'TST', attachedSpells: { will: ['guidance|tst'] } };
    const at = mount(item, structuredClone(original), original);
    fireEvent.click(screen.getByRole('button', { name: 'Add a spell' }));
    type('Spell 2', 'Aid');
    pick('Spell 2: how', 'daily');
    const stored = writeEntry({ original, draft: at.draft(), source: 'HB', mode: 'changes' });
    expect(stored.attachedSpells).toEqual({ will: ['guidance|tst'], daily: { '1e': ['Aid|TST'] } });
    expect(readStored(stored, original).entry.attachedSpells).toEqual(stored.attachedSpells);
  });

  it('keeps a list of spells with no limits as it was', () => {
    const at = mount(item, { ...NEW_ITEM, attachedSpells: ['fireball'] });
    expect(screen.getByText(/a list with no limits, kept as it is/)).toBeTruthy();
    expect(at.changes()).toBe(0);
  });

  it("a potion's cards are the in-play ones: no proficiency bonus tick, which in play refuses", () => {
    const castGuidance = { v: 1, effects: [{ kind: 'initiativeBonus', amount: 2 }] };
    const tick = () => screen.queryByRole('checkbox', { name: /Your proficiency bonus instead/ });
    mount(item, { ...NEW_ITEM, type: 'W', castGuidance });
    expect(tick()).not.toBeNull();
    cleanup();
    mount(item, { ...NEW_ITEM, type: 'P', castGuidance });
    expect(tick()).toBeNull();
  });
});

describe('fields at their edges (the U5b review)', () => {
  it('a copy that took a field out can fill it again: null reads as empty', () => {
    const book = { ...NEW_SPECIES, source: 'TST' };
    mount(species, {
      ...book,
      skillProficiencies: null,
      ability: null,
      additionalSpells: null,
    });
    expect(screen.queryByText(/kept as/)).toBeNull();
    chip('Skills', 'Stealth');
    cleanup();
    mount(feat, { ...NEW_FEAT, senses: null, prerequisite: null });
    expect(screen.queryByText(/kept as/)).toBeNull();
    expect(screen.getByLabelText('Species')).toBeTruthy();
    expect(screen.getByLabelText('Darkvision in feet')).toBeTruthy();
  });

  it('a count of their choice and the spell ability clear when emptied', () => {
    const at = mount(feat, { ...NEW_FEAT, skillProficiencies: [{ stealth: true, any: 1 }] });
    type('Skills of their choice', '');
    expect(at.draft().skillProficiencies).toEqual([{ stealth: true }]);
    cleanup();
    const spells = [{ ability: 'wis', innate: { _: { will: ['Guidance|TST'] } } }];
    const it2 = mount(feat, { ...NEW_FEAT, additionalSpells: spells });
    pick('Their attack and DC from', '');
    expect(it2.draft().additionalSpells).toEqual([{ innate: { _: { will: ['Guidance|TST'] } } }]);
  });

  it('spells that come to share a "1" count each keep their own', () => {
    const spells = [
      {
        innate: { '3': { daily: { '1': ['Aid|TST'] } }, '5': { daily: { '1': ['Guidance|TST'] } } },
      },
    ];
    const at = mount(species, { ...NEW_SPECIES, additionalSpells: spells });
    type('Spell 2: from level', '3');
    expect(at.draft().additionalSpells).toEqual([
      { innate: { '3': { daily: { '1e': ['Aid|TST', 'Guidance|TST'] } } } },
    ]);
    expect(screen.queryByText(/kept as/)).toBeNull();
  });

  it('a list of names holds what is typed while a name is edited', () => {
    const at = mount(feat, { ...NEW_FEAT, toolProficiencies: [{ alpha: true, beta: true }] });
    type('Tools', 'alphax, beta');
    expect(box('Tools')).toBe('alphax, beta');
    expect(at.draft().toolProficiencies).toEqual([{ beta: true, alphax: true }]);
    type('Tools', 'a, a');
    expect(box('Tools')).toBe('a, a');
  });

  it("an item's last spell takes its ability with it", () => {
    const at = mount(item, {
      ...NEW_ITEM,
      attachedSpells: { will: ['Guidance|TST'], ability: 'wis' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove spell 1' }));
    expect(at.draft()).not.toHaveProperty('attachedSpells');
  });

  it('a value the boxes do not offer is named as kept', () => {
    mount(feat, { ...NEW_FEAT, prerequisite: [{ proficiency: [{ armor: 'shields' }] }] });
    expect(screen.queryByLabelText('Armor training')).toBeNull();
    expect(screen.getByText(/a proficiency, kept as it is/)).toBeTruthy();
    cleanup();
    mount(feat, { ...NEW_FEAT, senses: [{ darkvision: 60, echolocation: 30 }] });
    expect(screen.getByText(/also echolocation, kept as it is/)).toBeTruthy();
    cleanup();
    mount(species, { ...NEW_SPECIES, conditionImmune: ['disease'] });
    expect(screen.getByText(/also disease, kept as it is/)).toBeTruthy();
    cleanup();
    mount(item, { ...NEW_ITEM, attachedSpells: { will: ['Guidance|TST'], ritual: ['alarm'] } });
    expect(screen.getByText(/also its ritual list, kept as it is/)).toBeTruthy();
  });

  it('a box that is never empty can be emptied while a number is typed', () => {
    const at = mount(feat, { ...NEW_FEAT, prerequisite: [{ ability: [{ str: 13 }] }] });
    type('At least', '');
    expect(box('At least')).toBe('');
    expect(at.draft().prerequisite).toEqual([{ ability: [{ str: 13 }] }]);
    type('At least', '15');
    expect(at.draft().prerequisite).toEqual([{ ability: [{ str: 15 }] }]);
    fireEvent.blur(screen.getByLabelText('At least'));
    expect(box('At least')).toBe('15');
  });

  it('a choice of abilities that names no count is a choice of one, from the ones it names', () => {
    const at = mount(species, { ...NEW_SPECIES, ability: [{ choose: { from: ['str', 'dex'] } }] });
    expect(box('Abilities of their choice')).toBe('1');
    expect(screen.getByText(/from STR, DEX only, kept as it is/)).toBeTruthy();
    type('Each raised by', '2');
    expect(at.draft().ability).toEqual([{ choose: { from: ['str', 'dex'], amount: 2 } }]);
  });

  it('spells open again by level, any level first', () => {
    const rows = [
      { spell: 'Aid|TST', how: 'known' as const, level: '3' },
      { spell: 'Guidance|TST', how: 'known' as const, level: '_' },
    ];
    const read = grantRows(grantsOf(rows, undefined));
    expect(read?.rows.map((r) => r.spell)).toEqual(['Guidance|TST', 'Aid|TST']);
  });
});

const LANTERNFOLK = {
  ...NEW_SPECIES,
  source: 'HB',
  ability: [{ dex: 2 }],
  darkvision: 60,
  languageProficiencies: [{ common: true }],
};

/** A level 5 Warrior of Lanternfolk and the subrace `sub`. */
const asSubrace = (sub: Json) =>
  hero(
    (d) => {
      d.race = { name: 'Lanternfolk', source: 'HB' };
      d.subrace = { name: String(sub.name), source: String(sub.source) };
    },
    { race: [LANTERNFOLK as DataEntity], subrace: [sub as DataEntity] },
  );

describe('subraces', () => {
  it('a new one picks its species first, and cannot be saved without one', () => {
    expect(subrace.check?.({ name: 'Deepfolk', entries: [] })).toBe(
      'Pick the species it belongs to.',
    );
    const at = mount(subrace, { name: 'Deepfolk', entries: [] }, undefined, {
      race: [LANTERNFOLK],
    });
    pick('Species', 'Lanternfolk|HB');
    expect(at.draft()).toMatchObject({ raceName: 'Lanternfolk', raceSource: 'HB' });
    expect(subrace.check?.(at.draft())).toBeUndefined();
  });

  it("its fields save, read back, and count over the species' own", () => {
    const start = { name: 'Deepfolk', raceName: 'Lanternfolk', raceSource: 'HB', entries: [] };
    const at = mount(subrace, start);
    // What it leaves empty is the species'.
    expect(screen.getByLabelText('Speed in feet').getAttribute('placeholder')).toBe(
      'As the species',
    );
    expect(screen.getByLabelText('Darkvision in feet').getAttribute('placeholder')).toBe(
      'As the species',
    );
    type('Darkvision in feet', '120');
    type('Strength +', '1');
    chip('Languages', 'Elvish');
    const stored = save(at.draft());
    expect(stored).toMatchObject({ darkvision: 120, ability: [{ str: 1 }] });
    const { sheet } = asSubrace(stored);
    // Ability scores and languages add to the species'; darkvision takes its place.
    expect(sheet.abilities.str.value).toBe(15);
    expect(sheet.abilities.dex.value).toBe(18);
    expect(sheet.senses).toContainEqual(
      expect.objectContaining({ sense: 'darkvision', range: 120 }),
    );
    expect(sheet.senses).not.toContainEqual(
      expect.objectContaining({ sense: 'darkvision', range: 60 }),
    );
    expect(sheet.languages).toEqual(expect.arrayContaining(['Common', 'Elvish']));
    reopen(subrace, stored);
    expect(box('Darkvision in feet')).toBe('120');
    expect(box('Strength +')).toBe('1');
  });

  it("a score both raise is the subrace's, as its caption says", () => {
    const deep = {
      name: 'Deepfolk',
      source: 'HB',
      raceName: 'Lanternfolk',
      raceSource: 'HB',
      ability: [{ dex: 1 }],
    };
    expect(asSubrace(deep).sheet.abilities.dex.value).toBe(17);
    mount(subrace, deep);
    expect(screen.getByText(/a score or a choice both give is the subrace's/)).toBeTruthy();
  });

  it("a copy's emptied fields: what it adds goes, what it replaces is none at all", () => {
    const original = {
      name: 'Deepfolk',
      source: 'HB',
      raceName: 'Lanternfolk',
      raceSource: 'HB',
      ability: [{ cha: 1 }],
      darkvision: 120,
      languageProficiencies: [{ elvish: true }],
      entries: [],
    };
    const at = mount(subrace, { ...structuredClone(original), name: 'Deep Copy' }, original);
    type('Charisma +', '');
    chip('Languages', 'Elvish');
    type('Darkvision in feet', '');
    // A copy cannot leave a field out: emptied, it is none, the species' too.
    expect(screen.getByLabelText('Darkvision in feet').getAttribute('placeholder')).toBe('None');
    expect(at.draft()).toMatchObject({ ability: [], languageProficiencies: [] });
    const stored = writeEntry({ draft: at.draft(), original, source: 'HB', mode: 'changes' });
    const read = readStored(stored, original).entry;
    const { sheet } = asSubrace(read);
    // The species' own +2 Dexterity and Common stay; the copy adds nothing of its own.
    expect(sheet.abilities.dex.value).toBe(18);
    expect(sheet.abilities.cha.value).toBe(10);
    expect(sheet.languages).toEqual(['Common']);
    expect(sheet.senses).toEqual([]);
    cleanup();
    const again = mount(subrace, read, original);
    expect(again.changes()).toBe(0);
    expect(box('Charisma +')).toBe('');
    expect(pressed('Languages', 'Elvish')).toBe('false');
  });

  /** The species editor at `path`, as the Workshop page shows it there. */
  function atAddress(path: string, draft: Json, extra: Extra, original?: Json) {
    const registry = withEntries(extra);
    function Seen() {
      const { pathname, search, state } = useLocation();
      return <p>{`${pathname}${search} ${JSON.stringify(state)}`}</p>;
    }
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/workshop/:action/:type?/:uid?"
            element={
              <species.Body
                draft={draft}
                change={() => {}}
                original={original}
                registry={registry}
                readOnly={false}
              />
            }
          />
          <Route path="/workshop/new/subrace" element={<Seen />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  const DEEP = { name: 'Deepfolk', source: 'HB', raceName: 'Lanternfolk', raceSource: 'HB' };
  const HILL = { name: 'Hillfolk', source: 'HB', raceName: 'Dwarf', raceSource: 'HB' };

  it('a saved species lists its own subraces, and Add a subrace opens one naming it', () => {
    // Just saved: the draft has no book, the address has.
    const { source: _, ...draft } = LANTERNFOLK;
    atAddress('/workshop/edit/race/Lanternfolk%7CHB?file=f1', draft, {
      race: [LANTERNFOLK],
      subrace: [DEEP, HILL],
    });
    const list = within(screen.getByRole('list', { name: 'Subraces' }));
    expect(list.getAllByRole('link').map((l) => l.textContent)).toEqual(['Deepfolk']);
    fireEvent.click(screen.getByRole('link', { name: 'Add a subrace' }));
    const seed = { seed: { raceName: 'Lanternfolk', raceSource: 'HB' } };
    expect(screen.getByText(`/workshop/new/subrace?file=f1 ${JSON.stringify(seed)}`)).toBeTruthy();
  });

  it("a saved copy's subraces are its own, not its original's", () => {
    const official = { ...LANTERNFOLK, source: 'TST' };
    const theirs = { ...DEEP, source: 'TST', raceSource: 'TST' };
    // Saved under the player's book; the draft still names the original's.
    atAddress(
      '/workshop/edit/race/Lanternfolk%7CHB',
      structuredClone(official),
      {
        race: [official, LANTERNFOLK],
        subrace: [theirs],
      },
      official,
    );
    expect(screen.queryByRole('list', { name: 'Subraces' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Add a subrace' }));
    expect(screen.getByText(/"raceSource":"HB"/)).toBeTruthy();
  });

  it('a species not saved yet, new or a copy, says to save it first', () => {
    for (const path of ['/workshop/new/race', '/workshop/copy/race/Lanternfolk%7CTST']) {
      atAddress(path, LANTERNFOLK, { race: [LANTERNFOLK], subrace: [DEEP] });
      expect(screen.getByText('Save the species to add a subrace to it.')).toBeTruthy();
      expect(screen.queryByRole('list', { name: 'Subraces' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Add a subrace' })).toBeNull();
      cleanup();
    }
  });
});

describe("an item's spell ability (the second U5b review)", () => {
  it('stays while its only spell is typed again', () => {
    const at = mount(item, {
      ...NEW_ITEM,
      attachedSpells: { will: ['Guidance|TST'], ability: 'wis' },
    });
    type('Spell 1', '');
    type('Spell 1', 'Aid');
    expect(at.draft().attachedSpells).toEqual({ will: ['Aid|TST'], ability: 'wis' });
  });

  it('stays while the item casts spells with its charges', () => {
    const charges = { '1': ['Aid|TST'] };
    const at = mount(item, { ...NEW_ITEM, attachedSpells: { charges, ability: 'int' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a spell' }));
    expect(at.draft().attachedSpells).toEqual({ charges, ability: 'int' });
    cleanup();
    const was = { will: ['Guidance|TST'], charges, ability: 'int' };
    const again = mount(item, { ...NEW_ITEM, attachedSpells: was });
    fireEvent.click(screen.getByRole('button', { name: 'Remove spell 1' }));
    expect(again.draft().attachedSpells).toEqual({ charges, ability: 'int' });
  });
});
