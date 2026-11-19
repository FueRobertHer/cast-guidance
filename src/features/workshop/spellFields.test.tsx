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

import { classSpellUidsFromEntities } from '@/data5e/spellLookup';
import { headerFacts } from '@/features/library/fmt';
import { spellMeta } from '@/features/sheet/spellMeta';
import { readStored, writeEntry } from './copyWriter';
import { editor as spell, withComponents } from './editors/SpellEditor';
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
    expect(screen.getByText(/Its range reads “Self \(20 feet sphere\)”/)).toBeTruthy();

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
    expect(screen.getByText(/Royalty is kept in the file/)).toBeTruthy();
    // Before board 5 a toggle rebuilt the components from V, S and M, and dropped R.
    fireEvent.click(chip('Components', 'Verbal'));
    expect(draft().components).toEqual({ s: true, r: true });
    fireEvent.click(chip('Components', 'Material'));
    fireEvent.change(screen.getByLabelText('Material'), { target: { value: 'a gold coin' } });
    expect(draft().components).toEqual({ s: true, m: 'a gold coin', r: true });

    const saved = save(draft());
    expect(saved.components).toEqual({ s: true, m: 'a gold coin', r: true });
    // Nothing on the sheet reads it yet, as the editor says.
    expect(headerFacts('spell', saved)).toContainEqual(['Components', 'S, M (a gold coin)']);
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
    expect(screen.getByText(/The sheet does not read these yet/)).toBeTruthy();
  });

  it('keeps a tag it has no chip for, and the Healing card and its flag agree', () => {
    const draft = mount({ name: 'Odd Mend', ...spell.blank(), miscTags: ['ZZZ'] });
    open();
    expect(screen.getByText('Flags, kept as written:')).toBeTruthy();
    fireEvent.click(chip('Area of effect', 'Single target'));
    // The Healing card, added from What it does, files the spell under Healing too.
    const does = screen.getByRole('heading', { name: 'What it does' }).parentElement as HTMLElement;
    fireEvent.click(within(does).getByRole('button', { name: 'Healing' }));
    expect(draft().miscTags).toEqual(['ZZZ', 'HL']);
    expect(pressed('Flags')).toEqual(['Healing']);
    fireEvent.click(chip('Flags', 'Healing'));
    expect(draft().miscTags).toEqual(['ZZZ']);
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
    // The Spells tab reads only `fromClassList` from a player's spell, as the editor says.
    expect(screen.getByText(/does not read a subclass’s list/)).toBeTruthy();
    expect([...classSpellUidsFromEntities([saved], 'Wizard')]).toEqual(['rune spark|myhomebrew']);
    expect([...classSpellUidsFromEntities([saved], 'Eldritch Knight')]).toEqual([]);

    cleanup();
    const back = mount(saved, knights());
    expect(pressed('On a subclass’s own list')).toEqual(['Eldritch Knight (Fighter)']);
    // Taking the class off leaves the subclass's list, and the other way round.
    fireEvent.click(chip('On the spell lists of', 'Wizard'));
    expect(back().classes).toEqual({ fromSubclass });
    fireEvent.click(chip('On a subclass’s own list', 'Eldritch Knight (Fighter)'));
    expect(back().classes).toBeUndefined();
  });

  it('keeps a list for a subclass the data does not have, and names it', () => {
    const other = {
      class: { name: 'Rogue', source: 'PHB' },
      subclass: { name: 'Arcane Trickster', shortName: 'Arcane Trickster', source: 'PHB' },
    };
    const draft = mount(
      { name: 'Quiet Hand', ...spell.blank(), classes: { fromSubclass: [other] } },
      knights(),
    );
    expect(screen.getByText('Arcane Trickster (Rogue)')).toBeTruthy();
    fireEvent.click(chip('On a subclass’s own list', 'Eldritch Knight (Fighter)'));
    expect((draft().classes as Json).fromSubclass).toEqual([
      other,
      expect.objectContaining({ subclass: expect.objectContaining({ name: 'Eldritch Knight' }) }),
    ]);
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
    // each of these was offered and then refused by + Effect.
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
