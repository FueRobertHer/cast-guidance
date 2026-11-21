// @vitest-environment jsdom
// The spell editor's fields from the One Workshop's board 5, each saved and
// read back, and what it offers to put on a spell's target (suspected bug 1).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import { homebrewLanding } from '@/engine/curated/effectCatalog';

// More's choices are recorded, and the one in `choice` is taken.
const { asked, choice } = vi.hoisted(() => ({
  asked: { current: [] as string[] },
  choice: { current: undefined as string | undefined },
}));
vi.mock('@/data5e/hooks', () => ({
  useTypePacks: () => ({ status: 'ready', error: null, offline: false, retry: () => undefined }),
}));
vi.mock('@/ui/dialogs', () => ({
  askChoice: (o: { options: Array<{ id: string }> }) => {
    asked.current = o.options.map((x) => x.id);
    return Promise.resolve(choice.current);
  },
}));

import { classSpellUidsFromEntities, subclassSpellUidsFromEntities } from '@/data5e/spellLookup';
import { parseSpellFilter, spellFitsQuery } from '@/engine/spellQuery';
import { newCharacterDoc } from '@/engine/types';
import { headerFacts } from '@/features/library/fmt';
import { castSpell } from '@/features/sheet/castResources';
import { spellNeedsConcentration } from '@/features/sheet/SpellManager';
import { spellMeta } from '@/features/sheet/spellMeta';
import { spellRollActions } from '@/features/sheet/spellRolls';
import { readStored, writeEntry } from './copyWriter';
import { editor as spell, withComponents, withMaterial } from './editors/SpellEditor';
import type { Json } from './editorTypes';

afterEach(() => {
  cleanup();
  asked.current = [];
  choice.current = undefined;
});

/** The editor on screen, as the Workshop holds it; returns the draft as it stands. */
function mount(start: Json, registry = new EntityRegistry(), original?: Json) {
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
      <spell.Body
        draft={draft}
        change={change}
        registry={registry}
        original={original}
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
const save = (draft: Json, original?: Json) =>
  writeEntry({ original, draft, source: 'MyHomebrew', mode: 'changes' });
const pick = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
/** A chip in one of the editor's groups of toggle chips. */
const chip = (group: string, name: string) =>
  within(screen.getByRole('group', { name: group })).getByRole('button', { name });
const pressed = (group: string) =>
  within(screen.getByRole('group', { name: group }))
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent);
/** What the editor holds, as it reads back from what Save stored over `original`. */
const readBack = (saved: Json, original: Json) => {
  const { entry, lost } = readStored(saved, original);
  expect(lost).toBe(0);
  return entry;
};

/** Burning Hands as the 2024 book's data has it, with the tags 5etools files it under. */
const HANDS: Json = {
  name: 'Burning Hands',
  source: 'XPHB',
  page: 248,
  level: 1,
  school: 'V',
  time: [{ number: 1, unit: 'action' }],
  range: { type: 'cone', distance: { type: 'feet', amount: 15 } },
  components: { v: true, s: true },
  duration: [{ type: 'instant' }],
  entries: [
    'A thin sheet of flames shoots forth from you. Each creature in a 15-foot {@variantrule Cone [Area of Effect]|XPHB|Cone} makes a Dexterity saving throw, taking {@damage 3d6} Fire damage on a failed save or half as much damage on a successful one.',
  ],
  damageInflict: ['fire'],
  savingThrow: ['dexterity'],
  miscTags: ['OBJ'],
  areaTags: ['N'],
};

/** The Eldritch Knight in both printings, and a class with no spells of its own. */
function knights(): EntityRegistry {
  const registry = new EntityRegistry();
  registry.addAll('class', [
    { name: 'Wizard', source: 'XPHB', spellcastingAbility: 'int', casterProgression: 'full' },
  ]);
  registry.addAll(
    'subclass',
    ['PHB', 'XPHB'].map((source) => ({
      name: 'Eldritch Knight',
      shortName: 'Eldritch Knight',
      source,
      className: 'Fighter',
      classSource: source,
      spellcastingAbility: 'int',
      casterProgression: '1/3',
    })),
  );
  registry.addAll('subclass', [
    { name: 'Champion', shortName: 'Champion', source: 'XPHB', className: 'Fighter' },
    // An ability for the spells it grants, and no list of its own to cast from.
    {
      name: 'Path of the Giant',
      shortName: 'Giant',
      source: 'BGG',
      className: 'Barbarian',
      spellcastingAbility: 'wis',
    },
  ]);
  return registry;
}

describe('the range shape (board 5)', () => {
  it('saves a shape and its size, and reads back as the sheet shows it', () => {
    const draft = mount({ name: 'Cinder Fan', ...spell.blank() });
    pick('Range', 'area');
    expect(draft().range).toEqual({ type: 'cone', distance: { type: 'feet', amount: 15 } });
    pick('Area', 'sphere');
    fireEvent.change(screen.getByLabelText('Feet'), { target: { value: '20' } });
    const range = { type: 'sphere', distance: { type: 'feet', amount: 20 } };
    expect(draft().range).toEqual(range);
    expect(
      screen.getByText(/Its range reads “Self \(20 feet sphere\)” in the Library/),
    ).toBeTruthy();
    expect(screen.getByText(/“Self \(20 ft sphere\)” in its row on the Spells tab/)).toBeTruthy();

    const saved = save(draft());
    expect(saved.range).toEqual(range);
    // Where the sheet reads it: the Library's and the rules sheet's facts, and the Spells tab's row.
    expect(headerFacts('spell', saved)).toContainEqual(['Range', 'Self (20 feet sphere)']);
    expect(spellMeta(saved)).toContain('Self (20 ft sphere)');

    cleanup();
    mount(saved);
    expect((screen.getByLabelText('Range') as HTMLSelectElement).value).toBe('area');
    expect((screen.getByLabelText('Area') as HTMLSelectElement).value).toBe('sphere');
    expect((screen.getByLabelText('Feet') as HTMLInputElement).value).toBe('20');
  });

  it('keeps a size in miles, and goes back to a point when another range is picked', () => {
    const draft = mount({
      name: 'Far Storm',
      ...spell.blank(),
      range: { type: 'radius', distance: { type: 'miles', amount: 1 } },
    });
    fireEvent.change(screen.getByLabelText('Miles'), { target: { value: '2' } });
    expect(draft().range).toEqual({ type: 'radius', distance: { type: 'miles', amount: 2 } });
    pick('Range', 'touch');
    expect(draft().range).toEqual({ type: 'point', distance: { type: 'touch' } });
    expect(screen.queryByLabelText('Area')).toBeNull();
  });

  it('starts a range in feet at 60 from miles, and carries feet over', () => {
    const draft = mount({
      name: 'Far Call',
      ...spell.blank(),
      range: { type: 'point', distance: { type: 'miles', amount: 1 } },
    });
    // One mile is not one foot.
    pick('Range', 'feet');
    expect(draft().range).toEqual({ type: 'point', distance: { type: 'feet', amount: 60 } });
    pick('Range', 'area');
    fireEvent.change(screen.getByLabelText('Feet'), { target: { value: '30' } });
    pick('Range', 'feet');
    expect(draft().range).toEqual({ type: 'point', distance: { type: 'feet', amount: 30 } });
  });

  it("changes a book spell's shape as a change, and reads back to the draft", () => {
    const draft = mount(structuredClone(HANDS), new EntityRegistry(), HANDS);
    expect((screen.getByLabelText('Area') as HTMLSelectElement).value).toBe('cone');
    fireEvent.change(screen.getByLabelText('Feet'), { target: { value: '30' } });
    const saved = save(draft(), HANDS);
    expect(saved.range).toEqual({ type: 'cone', distance: { type: 'feet', amount: 30 } });
    expect(readBack(saved, HANDS).range).toEqual(draft().range);
  });
});

describe('the R component (board 5)', () => {
  it('saves royalty, and keeps it when another component changes', () => {
    const draft = mount({ name: 'Tithe', ...spell.blank() });
    fireEvent.click(chip('Components', 'Royalty'));
    expect(draft().components).toEqual({ v: true, s: true, r: true });
    expect(screen.getByText(/Its components read “V, S, R \(1 gp\)” in the Library/)).toBeTruthy();
    // Before board 5 a toggle rebuilt the components from V, S and M, and dropped R.
    fireEvent.click(chip('Components', 'Verbal'));
    expect(draft().components).toEqual({ s: true, r: true });
    fireEvent.click(chip('Components', 'Material'));
    fireEvent.change(screen.getByLabelText('Material'), { target: { value: 'a gold coin' } });
    expect(draft().components).toEqual({ s: true, m: 'a gold coin', r: true });

    const saved = save(draft());
    expect(saved.components).toEqual({ s: true, m: 'a gold coin', r: true });
    // The Library and the rules sheet show it, as the editor says.
    expect(headerFacts('spell', saved)).toContainEqual([
      'Components',
      'S, M (a gold coin), R (1 gp)',
    ]);
    expect(screen.getByText(/“S, M \(a gold coin\), R \(1 gp\)”/)).toBeTruthy();
    cleanup();
    mount(saved);
    expect(pressed('Components')).toEqual(['Somatic', 'Material', 'Royalty']);
  });

  it("writes the data's order, keeps a material's own shape and any other key", () => {
    const comp = { m: { text: 'a diamond', cost: 5000 }, x: 'kept', v: true };
    expect(withComponents(comp, ['v', 'm', 'r'])).toEqual({
      v: true,
      m: { text: 'a diamond', cost: 5000 },
      r: true,
      x: 'kept',
    });
    expect(withComponents({ r: true }, [])).toBeUndefined();
  });
});

describe('the tags 5etools files a spell under (board 5)', () => {
  const open = () => fireEvent.click(screen.getByText('Tags for search'));

  it('saves each list and reads back with the same chips pressed', () => {
    const draft = mount({ name: 'Grave Chill', ...spell.blank() });
    expect(screen.getByText('None')).toBeTruthy();
    open();
    fireEvent.click(chip('Area of effect', 'Sphere'));
    fireEvent.click(chip('Area of effect', 'Multiple targets'));
    fireEvent.click(chip('Creature types it affects', 'Undead'));
    fireEvent.click(chip('Ability checks it calls for', 'Strength'));
    fireEvent.click(chip('Flags', 'Requires sight'));
    expect(screen.getByText('5 set')).toBeTruthy();
    const saved = save(draft());
    expect(saved).toMatchObject({
      areaTags: ['S', 'MT'],
      affectsCreatureType: ['undead'],
      abilityCheck: ['strength'],
      miscTags: ['SGT'],
    });
    cleanup();
    mount(saved);
    open();
    expect(pressed('Area of effect')).toEqual(['Multiple targets', 'Sphere']);
    expect(pressed('Creature types it affects')).toEqual(['Undead']);
    expect(pressed('Ability checks it calls for')).toEqual(['Strength']);
    expect(pressed('Flags')).toEqual(['Requires sight']);
    expect(screen.getByText(/finds this one by them/)).toBeTruthy();
    // Where they are read: a pick that filters by 5etools' tag keys.
    const pick = parseSpellFilter(
      'area style=MT|affects creature types=undead|ability check=strength|components & miscellaneous=sgt',
    );
    expect(pick !== undefined && spellFitsQuery(saved, pick)).toBe(true);
    const other = parseSpellFilter('affects creature types=fey');
    expect(other !== undefined && spellFitsQuery(saved, other)).toBe(false);
  });

  it('keeps a tag it has no chip for as one that takes it away, and shows the Healing tag', () => {
    const draft = mount({ name: 'Odd Mend', ...spell.blank(), miscTags: ['ZZZ'] });
    open();
    expect(pressed('Flags')).toEqual(['ZZZ, as written']);
    fireEvent.click(chip('Area of effect', 'Single target'));
    // The Healing card, added from What it does, files the spell under Healing too.
    const does = screen.getByRole('heading', { name: 'What it does' }).parentElement as HTMLElement;
    fireEvent.click(within(does).getByRole('button', { name: 'Healing' }));
    expect(draft().miscTags).toEqual(['ZZZ', 'HL']);
    expect(pressed('Flags')).toEqual(['Healing', 'ZZZ, as written']);
    fireEvent.click(chip('Flags', 'Healing'));
    expect(draft().miscTags).toEqual(['ZZZ']);
    fireEvent.click(chip('Flags', 'ZZZ, as written'));
    expect(draft().miscTags).toBeUndefined();
    expect(
      within(screen.getByRole('group', { name: 'Flags' })).queryByText(/as written/),
    ).toBeNull();
  });

  it("clears a book spell's tag as a change, and it stays cleared when read back", () => {
    const draft = mount(structuredClone(HANDS), new EntityRegistry(), HANDS);
    open();
    fireEvent.click(chip('Area of effect', 'Cone'));
    fireEvent.click(chip('Flags', 'Affects objects'));
    fireEvent.click(chip('Creature types it affects', 'Plant'));
    expect(draft().areaTags).toBeUndefined();
    const saved = save(draft(), HANDS);
    expect(saved).toMatchObject({ areaTags: null, miscTags: null, affectsCreatureType: ['plant'] });
    // A copy cannot delete what it copies: null is how it says none, as for every field.
    const back = readBack(saved, HANDS);
    expect(back).toMatchObject({ areaTags: null, miscTags: null, affectsCreatureType: ['plant'] });
    cleanup();
    mount(back, new EntityRegistry(), HANDS);
    expect(screen.getByText('1 set')).toBeTruthy();
    open();
    expect(pressed('Area of effect')).toEqual([]);
    expect(pressed('Flags')).toEqual([]);
    expect(pressed('Creature types it affects')).toEqual(['Plant']);
  });
});

describe("a subclass's own list (board 5)", () => {
  it('offers each subclass that casts, once, and saves it as 5etools writes it', () => {
    const draft = mount({ name: 'Rune Spark', ...spell.blank(), edition: 'one' }, knights());
    const group = within(screen.getByRole('group', { name: 'On a subclass’s own list' }));
    expect(group.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Eldritch Knight (Fighter)',
    ]);
    fireEvent.click(chip('On the spell lists of', 'Wizard'));
    fireEvent.click(chip('On a subclass’s own list', 'Eldritch Knight (Fighter)'));
    const fromSubclass = [
      {
        class: { name: 'Fighter', source: 'XPHB' },
        subclass: { name: 'Eldritch Knight', shortName: 'Eldritch Knight', source: 'XPHB' },
      },
    ];
    expect(draft().classes).toEqual({
      fromClassList: [{ name: 'Wizard', source: 'XPHB' }],
      fromSubclass,
    });
    const saved = save(draft());
    expect(saved.classes).toEqual(draft().classes);
    // The Spells tab reads each list where the editor says: the class's, and
    // the subclass caster's own.
    expect(screen.getByText(/finds it on the subclass’s own list/)).toBeTruthy();
    expect([...classSpellUidsFromEntities([saved], 'Wizard')]).toEqual(['rune spark|myhomebrew']);
    expect([...subclassSpellUidsFromEntities([saved], 'Fighter', ['Eldritch Knight'])]).toEqual([
      'rune spark|myhomebrew',
    ]);
    expect(subclassSpellUidsFromEntities([saved], 'Wizard', ['Eldritch Knight']).size).toBe(0);

    cleanup();
    const back = mount(saved, knights());
    expect(pressed('On a subclass’s own list')).toEqual(['Eldritch Knight (Fighter)']);
    // Taking the class off leaves the subclass's list, and the other way round.
    fireEvent.click(chip('On the spell lists of', 'Wizard'));
    expect(back().classes).toEqual({ fromSubclass });
    fireEvent.click(chip('On a subclass’s own list', 'Eldritch Knight (Fighter)'));
    expect(back().classes).toBeUndefined();
  });

  it('keeps a list for a subclass the data does not have, named, until it is taken away', () => {
    const other = {
      class: { name: 'Rogue', source: 'PHB' },
      subclass: { name: 'Arcane Trickster', shortName: 'Arcane Trickster', source: 'PHB' },
    };
    const draft = mount(
      { name: 'Quiet Hand', ...spell.blank(), classes: { fromSubclass: [other] } },
      knights(),
    );
    const group = 'On a subclass’s own list';
    expect(pressed(group)).toEqual(['Arcane Trickster (Rogue), as written']);
    fireEvent.click(chip(group, 'Eldritch Knight (Fighter)'));
    const knight = expect.objectContaining({
      subclass: expect.objectContaining({ name: 'Eldritch Knight' }),
    });
    expect((draft().classes as Json).fromSubclass).toEqual([other, knight]);
    fireEvent.click(chip(group, 'Arcane Trickster (Rogue), as written'));
    expect((draft().classes as Json).fromSubclass).toEqual([knight]);
    expect(within(screen.getByRole('group', { name: group })).queryByText(/as written/)).toBeNull();
  });

  it('knows a list a file names by its short name as the one it offers', () => {
    const registry = knights();
    registry.addAll('subclass', [
      {
        name: 'College of Spellsong',
        shortName: 'Spellsong',
        source: 'MyHomebrew',
        className: 'Bard',
        classSource: 'XPHB',
        casterProgression: '1/3',
      },
    ]);
    const short = { class: { name: 'Bard', source: 'XPHB' }, subclass: { name: 'Spellsong' } };
    const draft = mount(
      { name: 'Hum', ...spell.blank(), classes: { fromSubclass: [short] } },
      registry,
    );
    const group = 'On a subclass’s own list';
    // One chip, pressed, and none beside it as written.
    expect(pressed(group)).toEqual(['College of Spellsong (Bard)']);
    expect(within(screen.getByRole('group', { name: group })).queryByText(/as written/)).toBeNull();
    // Taking it away takes the entry as the file wrote it.
    fireEvent.click(chip(group, 'College of Spellsong (Bard)'));
    expect(draft().classes).toBeUndefined();
  });
});

/** A new spell that lasts, so its target list is on screen. */
const LASTING = (): Json => ({
  name: 'Lantern Ward',
  ...spell.blank(),
  duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
});

describe('what a spell puts on its target (suspected bug 1)', () => {
  it('offers only kinds + Effect puts on a target, and each one offered lands', async () => {
    mount(LASTING());
    // The chips beside More, the kinds offered first.
    const row = screen.getByRole('button', { name: 'More' }).parentElement as HTMLElement;
    const chips = within(row)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => t !== 'More');
    press('More');
    await waitFor(() => expect(asked.current.length).toBeGreaterThan(0));
    const offered = [...chips, ...asked.current];
    // A target holds numbers and rolls, not proficiencies, uses or actions:
    // each of these but the last was offered and then refused by + Effect.
    // Cast a spell passes without the fix: the editor gives the cards no
    // spells to cast, so it was never offered here (+ Effect refuses it too).
    for (const no of [
      'Ability score',
      'Skill',
      'Uses per rest',
      'Hit points per level',
      'Save proficiency',
      'Language',
      'Tool',
      'Weapon',
      'Action',
      'Cast a spell',
    ]) {
      expect(offered).not.toContain(no);
    }
    expect(offered).toEqual(
      expect.arrayContaining([
        'Armor Class',
        'Speed',
        'Resistance',
        'Ability score is at least',
        'Advantage',
        'Another way to work out AC',
      ]),
    );
    // Each one offered, added as it comes, is put on the target by + Effect.
    for (const kind of offered) {
      cleanup();
      const draft = mount(LASTING());
      if (chips.includes(kind)) press(kind);
      else {
        choice.current = kind;
        press('More');
      }
      await waitFor(() => {
        const g = draft().castGuidance as { effects?: unknown[] } | undefined;
        expect(g?.effects).toHaveLength(1);
      });
      const landing = homebrewLanding(save(draft()), 'spell');
      expect([kind, landing.problems]).toEqual([kind, []]);
      expect(landing.entry).toBeDefined();
    }
  });
});

/** A section of the editor, by its heading. */
const section = (name: string) =>
  screen.getByRole('heading', { name }).parentElement as HTMLElement;
const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const tick = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name }));

describe('how long it lasts, in About it', () => {
  it('saves a duration with concentration, and the sheet concentrates on it', () => {
    const draft = mount({ name: 'Lantern Ward', ...spell.blank() });
    expect(box('Duration').value).toBe('instant');
    expect(screen.queryByRole('checkbox', { name: 'Concentration' })).toBeNull();
    pick('Duration', 'minute');
    tick('Concentration');
    const duration = [
      { type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true },
    ];
    expect(draft().duration).toEqual(duration);
    // Concentration holds through a change of how long.
    pick('Duration', '10 minute');
    expect(draft().duration).toEqual([
      { ...duration[0], duration: { type: 'minute', amount: 10 } },
    ]);
    pick('Duration', 'minute');

    const saved = save(draft());
    expect(saved.duration).toEqual(duration);
    // Where the sheet reads it: the Library's facts, the Spells tab's row, and
    // casting it, which makes it the character's concentration.
    expect(headerFacts('spell', saved)).toContainEqual([
      'Duration',
      'Concentration, up to 1 minute',
    ]);
    expect(spellMeta(saved)).toContain('1 minute');
    expect(spellNeedsConcentration(saved)).toBe(true);
    const doc = newCharacterDoc('hero', 'Hero', 'test');
    castSpell((recipe) => recipe(doc), { maxHp: 100, edition: '2024' }, undefined, 1, {
      name: 'Lantern Ward',
      source: 'MyHomebrew',
      concentration: spellNeedsConcentration(saved),
    });
    expect(doc.play.concentratingOn).toEqual({ label: 'Lantern Ward' });

    cleanup();
    const back = mount(saved);
    expect(box('Duration').value).toBe('minute');
    expect(box('Concentration').checked).toBe(true);
    // Instantaneous cannot be concentrated on.
    pick('Duration', 'instant');
    expect(back().duration).toEqual([{ type: 'instant' }]);
    expect(screen.queryByRole('checkbox', { name: 'Concentration' })).toBeNull();
  });

  it('keeps a duration it has no option for, as written', () => {
    const draft = mount({
      name: 'Long Watch',
      ...spell.blank(),
      duration: [{ type: 'timed', duration: { type: 'day', amount: 7 } }],
    });
    const select = screen.getByLabelText('Duration') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.selectedOptions[0]?.textContent).toBe('7 days, as written');
    expect(draft().duration).toEqual([{ type: 'timed', duration: { type: 'day', amount: 7 } }]);
  });

  it('holds what it puts on the target in What it does, and takes away only those', () => {
    const draft = mount(LASTING());
    const does = within(section('What it does'));
    // How long is About it's alone now.
    expect(does.queryByRole('button', { name: 'Lasting effect' })).toBeNull();
    expect(does.queryByLabelText('Lasts')).toBeNull();
    expect(does.getByText('On the target while it lasts')).toBeTruthy();
    // With nothing on the target yet, there is nothing for it to take away.
    expect(does.queryByRole('button', { name: 'Remove what it does on the target' })).toBeNull();
    press('Armor Class');
    const effects = () => (draft().castGuidance as Json | undefined)?.effects;
    expect(effects()).toHaveLength(1);
    fireEvent.click(does.getByRole('button', { name: 'Remove what it does on the target' }));
    expect(effects()).toBeUndefined();
    expect(draft().duration).toEqual(LASTING().duration);

    // Effects left on a spell that stops lasting stay in sight, as the sheet still lands them.
    press('Armor Class');
    pick('Duration', 'instant');
    expect(does.getByText(/It does not last: give it a duration in About it/)).toBeTruthy();
    expect(effects()).toHaveLength(1);
    fireEvent.click(does.getByRole('button', { name: 'Remove what it does on the target' }));
    expect(does.queryByText('On the target while it lasts')).toBeNull();
  });
});

describe('casting times past an hour', () => {
  it('saves 8, 12 and 24 hours, each read back as picked', () => {
    for (const [key, number] of [
      ['8 hour', 8],
      ['12 hour', 12],
      ['24 hour', 24],
    ] as const) {
      cleanup();
      const draft = mount({ name: 'Long Rite', ...spell.blank() });
      pick('Casting time', key);
      expect(draft().time).toEqual([{ number, unit: 'hour' }]);
      const saved = save(draft());
      expect(saved.time).toEqual([{ number, unit: 'hour' }]);
      cleanup();
      mount(saved);
      expect(box('Casting time').value).toBe(key);
    }
  });
});

describe('a reaction trigger', () => {
  const trigger = 'which you take when you are hit by an attack roll';

  it('writes the trigger as 5etools does, and keeps it while it is still a reaction', () => {
    const draft = mount({ name: 'Ward Flash', ...spell.blank() });
    expect(screen.queryByLabelText('Trigger')).toBeNull();
    pick('Casting time', '1 reaction');
    pick('Trigger', trigger);
    const time = [{ number: 1, unit: 'reaction', condition: trigger }];
    expect(draft().time).toEqual(time);
    const saved = save(draft());
    expect(saved.time).toEqual(time);
    // The Library prints the casting time alone, as the caption says.
    expect(headerFacts('spell', saved)).toContainEqual(['Casting time', '1 reaction']);
    expect(screen.getByText(/do not show it yet: there it reads “1 reaction”/)).toBeTruthy();

    cleanup();
    const back = mount(saved);
    expect(box('Trigger').value).toBe(trigger);
    pick('Trigger', '');
    expect(back().time).toEqual([{ number: 1, unit: 'reaction' }]);
    pick('Trigger', trigger);
    pick('Casting time', '1 action');
    expect(back().time).toEqual([{ number: 1, unit: 'action' }]);
    expect(screen.queryByLabelText('Trigger')).toBeNull();
  });

  it("shows a trigger a file gives another casting time, and keeps the file's other times", () => {
    const smite = 'which you take immediately after hitting a target with a Melee weapon';
    const other = { number: 1, unit: 'action' };
    const draft = mount({
      name: 'Searing Hit',
      ...spell.blank(),
      time: [{ number: 1, unit: 'bonus', condition: smite }, other],
    });
    expect(box('Trigger').value).toBe(smite);
    pick('Trigger', `${smite} or an Unarmed Strike`);
    expect(draft().time).toEqual([
      { number: 1, unit: 'bonus', condition: `${smite} or an Unarmed Strike` },
      other,
    ]);
    // Emptied on the way to new words, the box stays for them.
    pick('Trigger', '');
    expect(draft().time).toEqual([{ number: 1, unit: 'bonus' }, other]);
    pick('Trigger', smite);
    expect(draft().time).toEqual([{ number: 1, unit: 'bonus', condition: smite }, other]);
  });
});

describe("a material's cost, and whether the spell consumes it", () => {
  const words = 'a diamond worth 300+ GP, which the spell consumes';

  it('saves both as 5etools writes them, and a pick finds the spell by them', () => {
    const draft = mount({ name: 'Diamond Ward', ...spell.blank() });
    fireEvent.click(chip('Components', 'Material'));
    pick('Material', words);
    expect(draft().components).toEqual({ v: true, s: true, m: words });
    pick('Cost in gold pieces', '300');
    tick('Consumed by the spell');
    const m = { text: words, cost: 30000, consume: true };
    expect(draft().components).toEqual({ v: true, s: true, m });

    const saved = save(draft());
    expect(saved.components).toEqual({ v: true, s: true, m });
    // The Library shows the words alone, as the caption says; the filters read the rest.
    expect(headerFacts('spell', saved)).toContainEqual(['Components', `V, S, M (${words})`]);
    expect(screen.getByText(/show the material’s words alone/)).toBeTruthy();
    for (const want of ['material with cost', 'material is consumed']) {
      const filter = parseSpellFilter(`components & miscellaneous=${want}`);
      expect([want, filter !== undefined && spellFitsQuery(saved, filter)]).toEqual([want, true]);
    }

    cleanup();
    const back = mount(saved);
    expect(box('Cost in gold pieces').value).toBe('300');
    expect(box('Consumed by the spell').checked).toBe(true);
    // Both cleared, it is the words alone again.
    pick('Cost in gold pieces', '');
    tick('Consumed by the spell');
    expect(back().components).toEqual({ v: true, s: true, m: words });
    expect(screen.queryByText(/show the material’s words alone/)).toBeNull();
  });

  it('keeps part of a gold piece, and a choice the book leaves to the caster, read back over it', () => {
    const book: Json = {
      ...HANDS,
      name: 'Pearl Charm',
      components: { v: true, m: { text: 'a pearl', cost: 10000, consume: 'optional' } },
    };
    const draft = mount(structuredClone(book), new EntityRegistry(), book);
    expect(box('Cost in gold pieces').value).toBe('100');
    expect(box('Consumed if the caster chooses').checked).toBe(true);
    // A point typed on the way to part of a gold piece stays on screen.
    pick('Cost in gold pieces', '12.');
    expect(box('Cost in gold pieces').value).toBe('12.');
    expect((draft().components as Json).m).toMatchObject({ cost: 1200 });
    pick('Cost in gold pieces', '12.5');
    expect(draft().components).toEqual({
      v: true,
      m: { text: 'a pearl', cost: 1250, consume: 'optional' },
    });
    // Not a number of gold pieces, or finer than a copper, is refused.
    for (const no of ['12gp', '12.505']) {
      pick('Cost in gold pieces', no);
      expect([no, (draft().components as Json).m]).toEqual([
        no,
        expect.objectContaining({ cost: 1250 }),
      ]);
      expect(box('Cost in gold pieces').value).toBe('12.5');
    }
    const saved = save(draft(), book);
    expect(readBack(saved, book).components).toEqual(draft().components);
  });

  it('turns the words into the object and back only as a cost or consuming comes and goes', () => {
    expect(withMaterial('soot', { cost: 100 })).toEqual({ text: 'soot', cost: 100 });
    expect(withMaterial({ text: 'soot', cost: 100 }, { cost: undefined })).toBe('soot');
    expect(withMaterial({ text: 'soot', consume: true, x: 1 }, { consume: undefined })).toEqual({
      text: 'soot',
      x: 1,
    });
    expect(withMaterial('', { text: 'ash' })).toBe('ash');
  });
});

describe('+ Damage over text that already says its damage', () => {
  const words =
    'Each creature in a 20-foot sphere makes a Constitution saving throw, taking 3d6 radiant damage on a failed save.';
  const tagged =
    'Each creature in a 20-foot sphere makes a Constitution saving throw, taking {@damage 3d6} radiant damage on a failed save.';

  it('tags the damage the text says, adding no sentence, and the sheet rolls its dice', () => {
    const draft = mount({ name: 'Dawn Flare', ...spell.blank(), entries: [words] });
    const does = within(section('What it does'));
    fireEvent.click(does.getByRole('button', { name: 'Damage' }));
    expect(draft().entries).toEqual([tagged]);
    expect(draft().damageInflict).toEqual(['radiant']);
    // One damage card, of the text's dice and type, and the text still reads as written.
    expect(does.getAllByText(/ damage$/).map((n) => n.textContent)).toEqual(['3d6 radiant damage']);
    expect(box('Text').value).toBe(words);

    const saved = save(draft());
    const rolls = spellRollActions(saved, { characterLevel: 5, abilityModifier: 4 });
    expect(rolls.map((r) => [r.expr, r.variant])).toEqual([['3d6', 'damage']]);

    // With no damage left untagged, + Damage gives the card a sentence to read.
    fireEvent.click(does.getByRole('button', { name: 'Damage' }));
    expect(draft().entries).toEqual([tagged, 'The target takes {@damage 1d8} fire damage.']);
  });
});
