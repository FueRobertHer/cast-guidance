// @vitest-environment jsdom
// U5b (ADR-002, board 5): the fields the species, feat, optional feature and
// item editors add. Each is edited as a player edits it, stored as Save
// stores it (`writeEntry`), counted where the sheet reads it, and opened again
// unchanged. A shape a field cannot show is kept, and stays as it was when
// another field is edited.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
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
import type { EditorSpec, Json } from './editorTypes';
import { grantRows, grantsOf } from './originFields';

afterEach(cleanup);

/** The editor on screen with the test world's spells; the draft as it stands, and how often it changed. */
function mount(spec: EditorSpec, start: Json, original?: Json) {
  let latest = start;
  let changes = 0;
  const registry = new EntityRegistry();
  registry.addAll('spell', makeTestContext().byType('spell') as Entity[]);
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

  it("a potion's cards are the in-play ones: no note that one counts only in play", () => {
    const castGuidance = { v: 1, effects: [{ kind: 'tempHpEachTurn', amount: 5 }] };
    mount(item, { ...NEW_ITEM, type: 'W', castGuidance });
    expect(screen.getByText(/This counts only in play/)).toBeTruthy();
    cleanup();
    mount(item, { ...NEW_ITEM, type: 'P', castGuidance });
    expect(screen.queryByText(/This counts only in play/)).toBeNull();
  });
});
