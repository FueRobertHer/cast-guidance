// @vitest-environment jsdom
// The Workshop's Pick card (rule pack port 4g): what each box stores, that
// every mix of boxes is one the reader takes strictly, that each one a card
// leaves is asked on a sheet and an answer gives what the card says, that a
// new pick takes an id the entry's other picks lack, that a shipped pick opens
// and keeps what no box shows, and the words for a pick.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import { Collector } from '@/engine/effects/base';
import { collectFeatEntity } from '@/engine/effects/feat';
import { readStoredEffects } from '@/engine/effects/mechanics';
import { type DataEntity, newCharacterDoc } from '@/engine/types';
import { pickWords } from '@/features/homebrew/pickWords';
import curated from '@/rules/cast-guidance/curated.json';
import standing from '@/rules/cast-guidance/standing.json';
import { makeTestContext } from '../../../tests-fixtures/testWorld';

const { choice } = vi.hoisted(() => ({ choice: { current: undefined as string | undefined } }));
vi.mock('@/ui/dialogs', () => ({
  askChoice: () => Promise.resolve(choice.current),
  askConfirm: () => Promise.resolve(true),
}));

import { moreKinds } from './EffectCards';
import { editor as feat } from './editors/FeatEditor';
import type { Json } from './editorTypes';
import { EntryPickIds, EntryPicks } from './pickIds';

afterEach(cleanup);

/** The feat editor on screen with these effects; returns its effects as they stand. */
function withCards(effects: Json[], taken: readonly string[] = []) {
  let latest: Json = {};
  const start: Json = { name: 'Gift', ...feat.blank(), castGuidance: { v: 1, effects } };
  function Harness() {
    const [draft, setDraft] = useState(start);
    latest = draft;
    const change = (patch: Json) =>
      setDraft((d) => {
        const next = { ...d, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
        return next;
      });
    return (
      <EntryPickIds.Provider value={() => new Set(taken)}>
        <feat.Body draft={draft} change={change} registry={new EntityRegistry()} readOnly={false} />
      </EntryPickIds.Provider>
    );
  }
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  return () => ((latest.castGuidance as Json | undefined)?.effects ?? []) as Json[];
}

const pick = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const box = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const has = (label: string) => screen.queryByLabelText(label) !== null;
const choices = (label: string) => [...box(label).options].map((o) => o.value);
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
/** A chip in the group of chips whose name starts with `group`. */
const chip = (group: string, name: string) =>
  fireEvent.click(
    within(screen.getByRole('group', { name: new RegExp(`^${group}`) })).getByRole('button', {
      name,
    }),
  );
const check = (label: string) => fireEvent.click(screen.getByLabelText(label));

/**
 * Boxes on screen showing a choice other than the value they hold: a value
 * none of a box's choices is would show as its first choice, unsaid.
 */
function misshown(): string[] {
  return screen.getAllByRole('combobox').flatMap((select) => {
    if (!(select instanceof HTMLSelectElement)) return [];
    const props = Object.entries(select).find(([k]) => k.startsWith('__reactProps'))?.[1] as
      | { value?: unknown }
      | undefined;
    const held = String(props?.value ?? '');
    return select.value === held ? [] : [`${select.getAttribute('aria-label')}: ${held}`];
  });
}
// The strict reading: a field the reader would pass over is a problem too.
const problems = (effects: Json[]) => readStoredEffects(effects, 'effects', true).problems;

const SKILL = { kind: 'skillProf', skill: '{pick}', level: 1 };

/** Add a Pick card through More, as a player does. */
async function addPick() {
  choice.current = 'Pick';
  press('More');
  await screen.findByLabelText('Pick: Asks for');
}

/** The homebrew feat Gift with these effects, taken by a Warrior 4, its answers `answers`. */
function collect(effects: Json[], answers: Record<string, string[]> = {}) {
  const gift: DataEntity = {
    name: 'Gift',
    source: 'HB',
    entries: [],
    castGuidance: { v: 1, effects },
  };
  const doc = newCharacterDoc('c', 'Hero', 't');
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: [] }];
  doc.choices = answers;
  const col = new Collector(doc, makeTestContext());
  collectFeatEntity(col, gift, 'gift|hb', 'f0');
  for (const fn of col.afterAll.splice(0)) fn();
  return col;
}
const ID = 'feat:gift|hb:f0:pick-choice';

describe('the add list', () => {
  it('offers a pick and a weapon, never a pick in play, and what a pick gives is no pick, pool or action', () => {
    expect(moreKinds({ inPlay: false, spells: false })).toEqual(
      expect.arrayContaining(['Pick', 'Weapon']),
    );
    expect(moreKinds({ inPlay: true, spells: false })).not.toContain('Pick');
    const inPick = moreKinds({ inPlay: false, spells: false, inPick: true });
    for (const k of ['Pick', 'Uses per rest', 'Action']) expect(inPick).not.toContain(k);
    // Its one add button offers the first chips' kinds too.
    expect(inPick).toEqual(expect.arrayContaining(['Skill', 'Ability score', 'Weapon']));
    expect(inPick).not.toContain('Cast a spell');
    expect(moreKinds({ inPlay: false, spells: true, inPick: true })).toContain('Cast a spell');
  });

  it('adds a pick of a skill, each giving its proficiency, as the reader takes it', async () => {
    const effects = withCards([]);
    await addPick();
    expect(effects()).toEqual([{ kind: 'pick', id: 'choice', ask: 'skill', gives: [SKILL] }]);
    expect(problems(effects())).toEqual([]);
    expect(screen.getByText('Asks for a skill')).toBeTruthy();
    expect(screen.getByText('Proficiency in the one picked')).toBeTruthy();
    expect(box('Each pick gives: Skill: Skill').value).toBe('{pick}');
    expect(screen.queryByText(/This does not count yet/)).toBeNull();
    // An id the reader takes needs no box.
    expect(has('Pick: Id')).toBe(false);
  });

  it('adds a weapon proficiency the reader takes', async () => {
    const effects = withCards([]);
    choice.current = 'Weapon';
    press('More');
    await screen.findByLabelText('Weapon: Weapon');
    pick('Weapon: Weapon', 'rapier');
    expect(effects()).toEqual([{ kind: 'weaponProf', name: 'rapier' }]);
    expect(problems(effects())).toEqual([]);
    expect(screen.getByText('Proficiency with rapier')).toBeTruthy();
  });
});

describe('a new pick’s id', () => {
  it('is one no other pick of the entry has, in its list or elsewhere in the entry', async () => {
    const other = { kind: 'pick', id: 'choice-2', ask: 'damage', gives: [] };
    const effects = withCards([other], ['choice', 'choice-3']);
    await addPick();
    expect(effects()[1]?.id).toBe('choice-4');
  });

  it("is one none of the entry's parts has, as the Workshop page tells its cards", async () => {
    const lore = { kind: 'pick', id: 'choice', ask: 'skill', gives: [SKILL] };
    const part = {
      type: 'entries',
      name: 'Lore',
      entries: [],
      castGuidance: { v: 1, effects: [lore] },
    };
    let latest: Json = {};
    function Harness() {
      const [draft, setDraft] = useState<Json>({ name: 'Gift', ...feat.blank(), entries: [part] });
      latest = draft;
      return (
        <EntryPicks draft={draft}>
          <feat.Body
            draft={draft}
            change={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            registry={new EntityRegistry()}
            readOnly={false}
          />
        </EntryPicks>
      );
    }
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    // A file's part holds a pick a feat's editor shows no card for: its id is still taken.
    choice.current = 'Pick';
    press('More');
    await screen.findByLabelText('Pick: Asks for');
    const own = ((latest.castGuidance as Json).effects as Json[])[0];
    expect(own?.id).toBe('choice-2');
  });

  it('stays as it is whatever else changes, so the answers saved for it keep', async () => {
    const effects = withCards([]);
    await addPick();
    pick('Pick: Asks for', 'save');
    pick('Pick: Prompt words', 'A sturdy save');
    pick('Pick: Asks for', 'option');
    expect(effects()[0]?.id).toBe('choice');
  });

  it('shows a box to fix one the reader does not take, or one another pick has', () => {
    withCards([{ kind: 'pick', id: 'skill:{feature}', ask: 'skill', gives: [SKILL] }]);
    expect(box('Pick: Id').value).toBe('skill:{feature}');
    expect(screen.getByText(/"id" is a short name/)).toBeTruthy();
    cleanup();
    const effects = withCards([
      { kind: 'pick', id: 'lore', ask: 'skill', gives: [SKILL] },
      { kind: 'pick', id: 'lore', ask: 'skill', gives: [SKILL] },
    ]);
    expect(screen.getAllByText(/give each pick its own "id"/)).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Pick: Id'), { target: { value: 'more-lore' } });
    expect(effects()[1]?.id).toBe('more-lore');
    expect(problems(effects())).toEqual([]);
  });
});

/** The effects of the cards the last walk left on screen. */
let lastEffects: () => Json[] = () => [];
const withCardsLast = (): Json => lastEffects()[0] as Json;

describe('the Pick card, each ask', () => {
  /** After each step of `steps`, the reader takes the card strictly. */
  async function walk(steps: Array<[string, () => unknown]>) {
    const effects = withCards([]);
    await addPick();
    for (const [step, act] of steps) {
      await act();
      expect(problems(effects()), step).toEqual([]);
      expect(misshown(), step).toEqual([]);
      expect(screen.queryByText(/This does not count yet/), step).toBeNull();
    }
    lastEffects = effects;
    return effects()[0] as Json;
  }

  it('asks for skills from a list, the class’s, or a language, in place of one held', async () => {
    const e = await walk([
      [
        'two from a list',
        () => {
          chip('From', 'Arcana');
          chip('From', 'History');
        },
      ],
      ['two of them', () => pick('Pick: How many', '2')],
      ['the class list', () => check("Pick: Or a skill on the class's list")],
      ['a language', () => check('Pick: Or a language')],
      ['its words', () => pick('Pick: Prompt words', 'Lore')],
      ['in place of', () => pick('Pick: In place of, if held already', 'Insight, Persuasion')],
      ['not in place', () => pick('Pick: In place of, if held already', '')],
      ['no class list', () => check("Pick: Or a skill on the class's list")],
      ['no language', () => check('Pick: Or a language')],
    ]);
    expect(e).toEqual({
      kind: 'pick',
      id: 'choice',
      ask: 'skill',
      gives: [SKILL],
      from: ['Arcana', 'History'],
      count: 2,
      label: 'Lore',
    });
    expect(screen.getByText('Asks for 2 skills from Arcana or History')).toBeTruthy();
    const asked = collect([e]);
    expect(asked.pending).toEqual([
      expect.objectContaining({ id: ID, kind: 'skill', label: 'Lore', count: 2 }),
    ]);
    expect(asked.pending[0]?.options.map((o) => o.id)).toEqual(['Arcana', 'History']);
    const answered = collect([e], { [ID]: ['Arcana', 'History'] });
    expect(answered.effects.filter((x) => x.kind === 'skillProf')).toEqual([
      expect.objectContaining({ skill: 'Arcana', level: 1 }),
      expect.objectContaining({ skill: 'History', level: 1 }),
    ]);
  });

  it('asks in place of a skill held, and gives it while not held', async () => {
    const e = await walk([
      [
        'from',
        () => {
          chip('From', 'Insight');
          chip('From', 'Performance');
        },
      ],
      ['in place of', () => pick('Pick: In place of, if held already', 'Persuasion')],
    ]);
    expect(
      screen.getByText(
        'Gives Persuasion; for each held already, asks for a skill from Insight or Performance',
      ),
    ).toBeTruthy();
    const free = collect([e]);
    expect(free.pending).toEqual([]);
    expect(free.effects).toEqual([
      expect.objectContaining({ kind: 'skillProf', skill: 'Persuasion' }),
    ]);
  });

  it('asks for a tool from names, in place of one held', async () => {
    const e = await walk([
      ['to a tool', () => pick('Pick: Asks for', 'tool')],
      ['from', () => pick('Pick: From', "Smith's Tools, Brewer's Supplies")],
      ['in place of', () => pick('Pick: In place of, if held already', "Thieves' Tools")],
      ['not in place', () => pick('Pick: In place of, if held already', '')],
    ]);
    expect(e).toEqual({
      kind: 'pick',
      id: 'choice',
      ask: 'tool',
      gives: [{ kind: 'toolProf', name: '{pick}' }],
      from: ["Smith's Tools", "Brewer's Supplies"],
    });
    const answered = collect([e], { [ID]: ["Brewer's Supplies"] });
    expect(answered.effects).toEqual([
      expect.objectContaining({ kind: 'toolProf', name: "Brewer's Supplies" }),
    ]);
  });

  it('asks for a weapon of kinds, or named, never both', async () => {
    const e = await walk([
      ['to a weapon', () => pick('Pick: Asks for', 'weapon')],
      ['simple too', () => chip('Of the kinds', 'Simple')],
      ['martial no more', () => chip('Of the kinds', 'Martial')],
      ['the last kind stays', () => chip('Of the kinds', 'Simple')],
      ['named', () => pick('Pick: Weapons', 'named')],
      ['from', () => pick('Pick: From', 'longsword, rapier')],
    ]);
    expect(e).toEqual({
      kind: 'pick',
      id: 'choice',
      ask: 'weapon',
      gives: [{ kind: 'weaponProf', name: '{pick}' }],
      from: ['longsword', 'rapier'],
    });
    const answered = collect([e], { [ID]: ['rapier'] });
    expect(answered.effects).toEqual([
      expect.objectContaining({ kind: 'weaponProf', name: 'rapier' }),
    ]);
    pick('Pick: Weapons', 'kinds');
    const kinds = collect([withCardsLast()]);
    expect(kinds.pending[0]?.options.length).toBeGreaterThan(0);
  });

  it('asks for a saving throw from abilities, in place of one held', async () => {
    const e = await walk([
      ['to a save', () => pick('Pick: Asks for', 'save')],
      [
        'from',
        () => {
          chip('From', 'Strength');
          chip('From', 'Dexterity');
        },
      ],
      ['in place of', () => chip('In place of', 'Wisdom')],
      ['not in place', () => chip('In place of', 'Wisdom')],
    ]);
    expect(e).toEqual({
      kind: 'pick',
      id: 'choice',
      ask: 'save',
      gives: [{ kind: 'saveProf', ability: '{pick}' }],
      from: ['str', 'dex'],
    });
    expect(screen.getByText('Asks for a saving throw from Strength or Dexterity')).toBeTruthy();
    const answered = collect([e], { [ID]: ['dex'] });
    expect(answered.effects).toEqual([
      expect.objectContaining({ kind: 'saveProf', ability: 'dex' }),
    ]);
  });

  it('asks for a damage type, giving its resistance', async () => {
    const e = await walk([
      ['to damage', () => pick('Pick: Asks for', 'damage')],
      [
        'from',
        () => {
          chip('From', 'fire');
          chip('From', 'cold');
        },
      ],
    ]);
    expect(e.gives).toEqual([{ kind: 'resist', damageType: '{pick}' }]);
    const answered = collect([e], { [ID]: ['cold'] });
    expect(answered.effects).toEqual([
      expect.objectContaining({ kind: 'resist', damageType: 'cold' }),
    ]);
  });

  it('asks for a spell of levels from class lists, giving it to cast', async () => {
    const e = await walk([
      ['to a spell', () => pick('Pick: Asks for', 'spell')],
      ['first level', () => chip('Of the levels', '1')],
      ['no cantrip', () => chip('Of the levels', 'Cantrip')],
      ['the last level stays', () => chip('Of the levels', '1')],
      ['from a list', () => pick('Pick: From the lists of', 'Wizard')],
      ['from any list', () => pick('Pick: From the lists of', '')],
      ['from a list again', () => pick('Pick: From the lists of', 'Wizard, Cleric')],
    ]);
    expect(e).toEqual({
      kind: 'pick',
      id: 'choice',
      ask: 'spell',
      gives: [{ kind: 'grantSpell', spell: '{pick}' }],
      spells: { levels: [1], classes: ['Wizard', 'Cleric'] },
    });
    expect(
      screen.getByText('Asks for a spell of level 1 from the Wizard or Cleric lists'),
    ).toBeTruthy();
    const asked = collect([e]);
    expect(asked.pending[0]).toMatchObject({
      id: ID,
      kind: 'spell',
      spellQuery: { levels: [1], classes: ['Wizard', 'Cleric'] },
    });
    const answered = collect([e], { [ID]: ['Magic Missile|PHB'] });
    expect(answered.effects).toEqual([
      expect.objectContaining({
        kind: 'grantSpell',
        spell: { name: 'Magic Missile', source: 'PHB' },
      }),
    ]);
  });

  it('asks for one of named options, each giving its own', async () => {
    const effects = withCards([]);
    await addPick();
    pick('Pick: Asks for', 'option');
    expect(problems(effects())).toEqual([]);
    pick('Pick: Option 1', 'Climber');
    pick('Pick: Option 2', 'Swimmer');
    press('Add an option');
    pick('Pick: Option 3', 'Gone');
    press('Remove option Gone');
    choice.current = 'Fly, swim or climb';
    press('Add to what option 1 gives');
    await screen.findByLabelText('Option 1 gives: Fly, swim or climb: Kind');
    pick('Option 1 gives: Fly, swim or climb: Kind', 'climb');
    press('Add to what option 2 gives');
    await screen.findByLabelText('Option 2 gives: Fly, swim or climb: Kind');
    pick('Option 2 gives: Fly, swim or climb: Kind', 'swim');
    const e = effects()[0] as Json;
    expect(e).toEqual({
      kind: 'pick',
      id: 'choice',
      ask: 'option',
      options: [
        {
          id: 'option-1',
          label: 'Climber',
          gives: [{ kind: 'moveSpeed', mode: 'climb', speed: 'walk' }],
        },
        {
          id: 'option-2',
          label: 'Swimmer',
          gives: [{ kind: 'moveSpeed', mode: 'swim', speed: 'walk' }],
        },
      ],
    });
    expect(problems(effects())).toEqual([]);
    expect(misshown()).toEqual([]);
    expect(screen.getByText('Asks for one of Climber or Swimmer')).toBeTruthy();
    const asked = collect([e]);
    expect(asked.pending[0]?.options.map((o) => [o.id, o.label])).toEqual([
      ['option-1', 'Climber'],
      ['option-2', 'Swimmer'],
    ]);
    const answered = collect([e], { [ID]: ['option-2'] });
    expect(answered.effects).toEqual([
      expect.objectContaining({ kind: 'moveSpeed', mode: 'swim' }),
    ]);
  });
});

describe('turning a pick to another ask', () => {
  it('leaves what only the old ask reads, and turns what it gives while it is as it started', async () => {
    const effects = withCards([]);
    await addPick();
    chip('From', 'Arcana');
    check('Pick: Or a language');
    pick('Pick: How many', '2');
    pick('Pick: Asks for', 'save');
    expect(effects()).toEqual([
      {
        kind: 'pick',
        id: 'choice',
        count: 2,
        ask: 'save',
        gives: [{ kind: 'saveProf', ability: '{pick}' }],
      },
    ]);
  });

  it('keeps what it gives once the player has changed it', async () => {
    const effects = withCards([]);
    await addPick();
    pick('Each pick gives: Skill: Level', '2');
    pick('Pick: Asks for', 'tool');
    expect(effects()[0]?.gives).toEqual([{ kind: 'skillProf', skill: '{pick}', level: 2 }]);
  });
});

describe('what each pick gives', () => {
  it('offers the one picked where it fits, and the cards say their own problems once', async () => {
    const effects = withCards([]);
    await addPick();
    pick('Pick: Asks for', 'save');
    choice.current = 'Ability score';
    press('Add to what each pick gives');
    await screen.findByLabelText('Each pick gives: Ability score: Ability');
    expect(choices('Each pick gives: Ability score: Ability')).toContain('{pick}');
    pick('Each pick gives: Ability score: Ability', '{pick}');
    expect(screen.getByText('+1 the one picked')).toBeTruthy();
    expect(problems(effects())).toEqual([]);
    pick('Each pick gives: Ability score: Amount', 'oops(');
    // The card of what it gives says it; the pick's own card does not again.
    const lines = screen.getAllByText(/This does not count yet/);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.textContent).toMatch(/"amount"/);
    expect(problems(effects())).toEqual([
      expect.stringMatching(/^effect 1 \(pick\): "gives": effect 2/),
    ]);
  });

  it('offers no one picked where it does not fit: a skill is not an ability', async () => {
    withCards([]);
    await addPick();
    expect(choices('Each pick gives: Skill: Skill')).toContain('{pick}');
    choice.current = 'Ability score';
    press('Add to what each pick gives');
    await screen.findByLabelText('Each pick gives: Ability score: Ability');
    expect(choices('Each pick gives: Ability score: Ability')).not.toContain('{pick}');
  });

  it('takes away what each gives, the last one leaving a line that says what is missing', async () => {
    const effects = withCards([]);
    await addPick();
    press('Remove Proficiency in the one picked');
    expect(effects()[0]).not.toHaveProperty('gives');
    expect(screen.getByText(/"gives" says what each pick gives/)).toBeTruthy();
  });
});

describe('a shipped pick on a card', () => {
  const picks = (rows: Array<{ keys: string[]; effects: unknown[] }>) =>
    rows.flatMap((row) =>
      (row.effects as Json[])
        .filter((e) => e.kind === 'pick')
        .map((effect) => ({ key: row.keys[0] ?? '', effect })),
    );
  const shipped = [
    ...picks(curated.rows as Array<{ keys: string[]; effects: unknown[] }>),
    ...picks(standing.rows as Array<{ keys: string[]; effects: unknown[] }>),
  ];

  it('opens every one, worded, and keeps it whole while another box changes', () => {
    expect(shipped.length).toBeGreaterThan(50);
    for (const { key, effect } of shipped) {
      const effects = withCards([effect]);
      expect(document.body.textContent, key).not.toMatch(/undefined|NaN|\[object/);
      expect(screen.getByText(pickWords(effect)), key).toBeTruthy();
      expect(misshown(), key).toEqual([]);
      pick('Pick: Rules', '2014');
      pick('Pick: Rules', '');
      expect(effects(), key).toEqual([effect]);
      cleanup();
    }
  });
});

describe('a pick in words', () => {
  it.each([
    [{ ask: 'skill' }, 'Asks for a skill'],
    [{ ask: 'skill', count: 2, classSkills: true }, "Asks for 2 skills from the class's skills"],
    [
      { ask: 'skill', from: ['Arcana', 'History', 'Nature'], orLanguage: true },
      'Asks for a skill from Arcana, History or Nature, or a language',
    ],
    [{ ask: 'tool', from: ["artisan's tools"] }, "Asks for a tool from artisan's tools"],
    [
      { ask: 'weapon', weapons: { filter: 'type=melee weapon', without: ['2H'] } },
      'Asks for a melee weapon, not Two-Handed',
    ],
    [
      { ask: 'weapon', from: ['longsword', 'rapier'] },
      'Asks for a weapon from longsword or rapier',
    ],
    [
      { ask: 'save', count: { byLevel: { 1: 1, 10: 2 } } },
      'Asks for saving throws, as many as its level table says',
    ],
    [
      { ask: 'damage', from: ['fire', 'cold', 'lightning'] },
      'Asks for a damage type from fire, cold or lightning',
    ],
    [{ ask: 'spell', spells: { levels: [0] }, count: 2 }, 'Asks for 2 cantrips'],
    [
      { ask: 'spell', spells: { levels: [0, 1], classes: ['Wizard'] } },
      'Asks for a cantrip or spell of level 1 from the Wizard list',
    ],
    [
      { ask: 'option', options: [{ id: 'a', label: 'Fire' }, { id: 'b' }] },
      'Asks for one of Fire or b',
    ],
    [
      {
        ask: 'weaponMastery',
        count: { tableColumn: 'Weapon Mastery', else: 2 },
        proficient: true,
        afterBuild: true,
      },
      "Asks for kinds of weapon to master, as many as the class table's Weapon Mastery column says, else 2, among those you are proficient with, once the build is in",
    ],
    [
      { ask: 'save', inPlaceOf: ['int', 'wis'], from: ['dex'] },
      'Gives Intelligence and Wisdom; for each held already, asks for a saving throw from Dexterity',
    ],
  ])('%j', (e, words) => {
    expect(pickWords({ kind: 'pick', id: 'x', ...e })).toBe(words);
  });
});
