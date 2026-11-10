// @vitest-environment jsdom
// What each Workshop editor puts in the entry, and what Save then stores.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import { writeEntry } from './copyWriter';
import { editor as background, featLabel } from './editors/BackgroundEditor';
import { abilityFor, abilityPicks, editor as feat } from './editors/FeatEditor';
import { editor as optional } from './editors/OptionalFeatureEditor';
import { editor as species, withWalkSpeed } from './editors/SpeciesEditor';
import { EDITORS, type EditorSpec, type Json } from './editorTypes';
import { prerequisiteLevel, withPrerequisiteLevel } from './fields';
import { originOf, renamed, restore } from './PartList';

afterEach(cleanup);

/** An editor on screen, as the Workshop holds it; returns the draft as it stands. */
function mount(spec: EditorSpec, start: Json, original?: Json, registry = new EntityRegistry()) {
  let latest = start;
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
  return () => latest;
}

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = (draft: Json, original?: Json) =>
  writeEntry({ original, draft, source: 'MyHomebrew', mode: 'changes' });
const segment = (part: string, mode: string) =>
  fireEvent.click(
    within(screen.getByRole('group', { name: `${part}: keep, change or remove` })).getByRole(
      'button',
      { name: mode },
    ),
  );

describe('the editors the Workshop finds', () => {
  it('one per file, by the type each edits', () => {
    const types = [...EDITORS.keys()];
    expect(types).toEqual(
      expect.arrayContaining(['background', 'feat', 'optionalfeature', 'race']),
    );
    expect(types.every((t) => /^[a-z]+$/.test(t))).toBe(true);
  });
});

describe('FeatEditor', () => {
  it('builds a new feat, with what it does on the sheet', () => {
    const draft = mount(feat, { name: 'Steady', ...feat.blank() });
    press('Strength');
    press('Dexterity');
    type('Character level needed', '4');
    fireEvent.click(screen.getByLabelText('Can be taken more than once'));
    press('Armor Class');
    expect(save(draft())).toEqual({
      name: 'Steady',
      source: 'MyHomebrew',
      category: 'G',
      entries: [],
      ability: [{ choose: { from: ['str', 'dex'] } }],
      prerequisite: [{ level: 4 }],
      repeatable: true,
      castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: 1 }] },
    });
  });

  it('saves a copy with a benefit removed as that one change', () => {
    const alert: Json = {
      name: 'Alert',
      source: 'XPHB',
      category: 'O',
      entries: [
        'You gain the following benefits.',
        { type: 'entries', name: 'Initiative Proficiency', entries: ['Add it.'] },
        { type: 'entries', name: 'Initiative Swap', entries: ['Swap.'] },
      ],
    };
    const draft = mount(feat, structuredClone(alert), alert);
    segment('Initiative Swap', 'Remove');
    expect(screen.getByText('Removed')).toBeTruthy();
    const out = save(draft(), alert);
    expect(out).not.toHaveProperty('entries');
    expect((out._copy as Json)._mod).toEqual({
      entries: [{ mode: 'removeArr', names: ['Initiative Swap'] }],
    });
    // Put back, it is no change at all.
    segment('Initiative Swap', 'Keep');
    expect(draft().entries).toEqual(alert.entries);
  });

  it('shows tagged book text as printed, and rewrites it from the words it reads as', () => {
    const draft = mount(feat, {
      name: 'Hardy',
      entries: ['Your {@variantrule Hit Points|XPHB|Hit Point} maximum increases by 2.'],
    });
    expect(screen.queryByLabelText('Paragraphs')).toBeNull();
    press('Write your own text');
    expect(draft().entries).toEqual(['Your Hit Point maximum increases by 2.']);
    expect((screen.getByLabelText('Paragraphs') as HTMLTextAreaElement).value).toBe(
      'Your Hit Point maximum increases by 2.',
    );
  });

  it('says on the card what keeps an effect from counting', () => {
    mount(feat, { name: 'Odd', ...feat.blank() });
    press('Armor Class');
    type('Amount', 'nonsense(');
    expect(screen.getByText(/This does not count yet/)).toBeTruthy();
  });

  it('reads the ability blocks it can edit, and keeps the rest out of reach', () => {
    expect(abilityPicks([{ cha: 1 }])).toEqual({ picks: ['cha'], extra: {} });
    expect(abilityPicks([{ choose: { from: ['str', 'dex'] } }])).toEqual({
      picks: ['str', 'dex'],
      extra: {},
    });
    const boon = [{ choose: { from: ['str', 'dex'] }, max: 30 }];
    expect(abilityFor(abilityPicks(boon)?.picks.slice(0, 1) ?? [], { max: 30 })).toEqual([
      { str: 1, max: 30 },
    ]);
    expect(abilityPicks([{ str: 1, dex: 1 }])).toBeUndefined();
    expect(abilityPicks([{ choose: { from: ['str'], count: 2 } }])).toBeUndefined();
    expect(abilityFor([], {})).toBeUndefined();
  });
});

describe('BackgroundEditor', () => {
  // Shaped like the 2024 Acolyte.
  const acolyte: Json = {
    name: 'Acolyte',
    source: 'XPHB',
    ability: [
      { choose: { weighted: { from: ['int', 'wis', 'cha'], weights: [2, 1] } } },
      { choose: { weighted: { from: ['int', 'wis', 'cha'], weights: [1, 1, 1] } } },
    ],
    feats: [{ 'magic initiate; cleric|xphb': true }],
    skillProficiencies: [{ insight: true, religion: true }],
    toolProficiencies: [{ "calligrapher's supplies": true }],
    entries: [{ type: 'list', items: [{ type: 'item', name: 'Feat:', entry: 'Magic Initiate' }] }],
  };
  const registry = new EntityRegistry();
  registry.addAll('feat', [
    { name: 'Alert', source: 'XPHB', category: 'O' },
    { name: 'Grappler', source: 'XPHB', category: 'G' },
  ]);

  it('saves a copy as the fields it changed', () => {
    const draft = mount(background, structuredClone(acolyte), acolyte, registry);
    press('Arcana');
    press('Charisma');
    expect(background.check?.(draft())).toBe('Pick three ability scores, or none.');
    press('Strength');
    expect(background.check?.(draft())).toBeUndefined();
    type('Origin feat', 'alert|xphb');
    // Grappler is no origin feat.
    expect(screen.queryByRole('option', { name: /Grappler/ })).toBeNull();
    const out = save(draft(), acolyte);
    expect(out).toEqual({
      name: 'Acolyte',
      source: 'MyHomebrew',
      skillProficiencies: [{ insight: true, religion: true, arcana: true }],
      ability: [
        { choose: { weighted: { from: ['str', 'int', 'wis'], weights: [2, 1] } } },
        { choose: { weighted: { from: ['str', 'int', 'wis'], weights: [1, 1, 1] } } },
      ],
      feats: [{ 'alert|xphb': true }],
      _copy: { name: 'Acolyte', source: 'XPHB' },
      castGuidance: expect.objectContaining({ basedOn: 'Acolyte|XPHB' }),
    });
  });

  it('names a feat it does not list in words', () => {
    expect(featLabel('magic initiate; cleric|xphb')).toBe('Magic Initiate, Cleric (XPHB)');
    expect(featLabel('alert|xphb')).toBe('Alert (XPHB)');
  });

  it('keeps a tool typed with commas, and the languages of your choice', () => {
    const draft = mount(background, { name: 'Wayfarer', ...background.blank() });
    type('Tool proficiencies', "Thieves' Tools, cartographer's tools");
    type('Languages of your choice', '2');
    expect(save(draft())).toMatchObject({
      toolProficiencies: [{ "thieves' tools": true, "cartographer's tools": true }],
      languageProficiencies: [{ anyStandard: 2 }],
    });
  });
});

describe('SpeciesEditor', () => {
  const dwarf: Json = {
    name: 'Dwarf',
    source: 'XPHB',
    size: ['M'],
    speed: 30,
    darkvision: 120,
    resist: ['poison'],
    entries: [
      { type: 'entries', name: 'Dwarven Resilience', entries: ['You resist poison.'] },
      { type: 'entries', name: 'Stonecunning', entries: ['You know stone.'] },
    ],
  };

  it('saves a renamed trait, with its own effects, as that trait changed', () => {
    const draft = mount(species, structuredClone(dwarf), dwarf);
    type('Darkvision in feet', '');
    segment('Dwarven Resilience', 'Change');
    const name = screen.getByLabelText('Trait name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Stone Gut' } });
    press('Resistance');
    const out = save(draft(), dwarf);
    expect(out.darkvision).toBeNull();
    expect((out._copy as Json)._mod).toEqual({
      entries: [
        {
          mode: 'replaceArr',
          replace: 'Dwarven Resilience',
          items: [
            {
              type: 'entries',
              name: 'Stone Gut',
              entries: ['You resist poison.'],
              castGuidance: {
                v: 1,
                basedOn: 'Dwarven Resilience|XPHB',
                effects: [{ kind: 'resist', damageType: 'fire' }],
              },
            },
          ],
        },
      ],
    });
  });

  it('changes the walking speed and keeps the others', () => {
    expect(withWalkSpeed({ walk: 30, fly: 30 }, 35)).toEqual({ walk: 35, fly: 30 });
    expect(withWalkSpeed({ walk: 30, fly: 30 }, undefined)).toEqual({ fly: 30 });
    expect(withWalkSpeed(30, 25)).toBe(25);
  });
});

describe('OptionalFeatureEditor', () => {
  it('needs a list it is on', () => {
    const draft = mount(optional, { name: 'Gaze', ...optional.blank() });
    expect(optional.check?.(draft())).toBeUndefined();
    press('Eldritch invocation');
    expect(optional.check?.(draft())).toBe('Pick at least one list it is on.');
  });

  it("changes the level in a class's prerequisite and keeps the class", () => {
    const pre = [{ level: { level: 2, class: { name: 'Warlock', source: 'XPHB' } }, spell: ['x'] }];
    const draft = mount(optional, { name: 'Blast', featureType: ['EI'], prerequisite: pre });
    expect(screen.getByText(/a spell, kept as it is/)).toBeTruthy();
    type('Character level needed', '5');
    expect(draft().prerequisite).toEqual([
      { level: { level: 5, class: { name: 'Warlock', source: 'XPHB' } }, spell: ['x'] },
    ]);
  });
});

describe('prerequisites', () => {
  it('edits one level, and none where the alternatives differ', () => {
    expect(prerequisiteLevel(undefined)).toEqual({ editable: true, others: [] });
    expect(prerequisiteLevel([{ level: 4, ability: [{ str: 13 }] }, { level: 4 }])).toEqual({
      editable: true,
      level: 4,
      others: ['an ability score'],
    });
    expect(prerequisiteLevel([{ level: 4 }, { level: 8 }]).editable).toBe(false);
    expect(prerequisiteLevel([{ level: 4 }, { feat: ['x'] }]).editable).toBe(false);
  });

  it('takes the level out, and the prerequisite with it once nothing is left', () => {
    expect(withPrerequisiteLevel([{ level: 4 }], undefined)).toBeUndefined();
    expect(withPrerequisiteLevel([{ level: 4, spell: ['x'] }], undefined)).toEqual([
      { spell: ['x'] },
    ]);
    expect(withPrerequisiteLevel(undefined, 8)).toEqual([{ level: 8 }]);
  });
});

describe('parts', () => {
  const part = (name: string) => ({ type: 'entries', name, entries: [] });

  it('a renamed part points at its old name until it is named that again', () => {
    const r = renamed(part('Stonecunning'), 'Rock Sense', 'Stonecunning', 'XPHB');
    expect(r.castGuidance).toEqual({ v: 1, basedOn: 'Stonecunning|XPHB' });
    expect(originOf(r)).toBe('Stonecunning');
    expect(renamed(r, 'Stonecunning', 'Stonecunning', 'XPHB')).toEqual(part('Stonecunning'));
  });

  it('puts a part back where the original had it, before the ones the player added', () => {
    const names = ['A', 'B', 'C'];
    expect(restore([part('A'), part('C'), part('New')], part('B'), names)).toEqual([
      part('A'),
      part('B'),
      part('C'),
      part('New'),
    ]);
    expect(restore(['text', part('A'), part('New')], part('C'), names)).toEqual([
      'text',
      part('A'),
      part('C'),
      part('New'),
    ]);
  });
});
