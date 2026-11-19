// @vitest-environment jsdom
// The modifiers row under every card (ADR-002, D6): each modifier is offered
// exactly where the reader takes it, Counts when and Lasts move a card into a
// moment and back without touching what else the guidance holds, and a feat
// written that way puts its effect on at the moment, on a real sheet.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import { FORMULA_FIELDS } from '@/engine/castGuidance';
import { deriveSheet } from '@/engine/derive';
import { knockedOut } from '@/engine/effectLife';
import { readStoredEffects } from '@/engine/effects/mechanics';
import { readMoments } from '@/engine/moments';
import { type DataEntity, type EngineContext, newCharacterDoc } from '@/engine/types';
import { makeTestContext } from '../../../../tests-fixtures/testWorld';
import { EffectCards } from '../EffectCards';
import { editor as feat } from '../editors/FeatEditor';
import type { Json } from '../editorTypes';
import { cards as abilities } from './abilities';
import { cards as actions } from './actions';
import { cards as attacks } from './attacks';
import { cards as defenses } from './defenses';
import type { Eff, KindSpec } from './kit/types';
import { cards as movement } from './movement';
import { cards as rolls } from './rolls';
import { cards as spells } from './spells';
import { cards as words } from './words';

vi.mock('@/ui/dialogs', () => ({ askChoice: () => Promise.resolve(undefined) }));

afterEach(cleanup);

const SPECS: readonly KindSpec[] = [
  ...abilities,
  ...defenses,
  ...movement,
  ...attacks,
  ...spells,
  ...rolls,
  ...actions,
  ...words,
];

const MODIFIERS = ['Only while', 'Grows with level', 'Rules version', 'Counts when', 'Lasts'];

/** A card's modifier chip. */
const chip = (title: string, label: string, pressed?: boolean) =>
  within(screen.getByRole('group', { name: `${title}: modifiers` })).getByRole('button', {
    name: label,
    ...(pressed === undefined ? {} : { pressed }),
  });

/** The modifiers a card offers: those whose chip is not marked as refused. */
function offered(title: string): string[] {
  const row = screen.getByRole('group', { name: `${title}: modifiers` });
  const chips = within(row).getAllByRole('button');
  // The same five sit under every card, refused or not.
  expect(chips.map((b) => b.textContent)).toEqual(MODIFIERS);
  return chips
    .filter((b) => b.getAttribute('aria-disabled') !== 'true')
    .map((b) => b.textContent ?? '');
}

const problems = (e: unknown) => readStoredEffects([e]).problems;
/** Whether the reader takes a whole one of a kind with `patch`, with nothing to say. */
const takes = (e: Eff, patch: Json) => problems({ ...e, ...patch }).length === 0;
/** Whether a moment can put `e` on, with nothing to say. */
const atMoment = (e: Eff) =>
  readMoments([{ at: 'zeroHp', do: [{ kind: 'addEffect', name: 'X', effects: [e] }] }], 'X')
    .problems.length === 0;

describe('the modifiers each card offers', () => {
  // What a kind may take is asked of a whole one: the reader says only the first
  // field it refuses, so a card still being filled in would hide the rest.
  it.each(
    SPECS.map((s) => [s.add, s] as const),
  )('%s has a whole one the reader takes', (_, spec) => {
    expect(problems(spec.sample?.() ?? spec.make())).toEqual([]);
  });

  it.each(SPECS.map((s) => [s.add, s] as const))('%s offers what the reader takes', (_, spec) => {
    const made = spec.make();
    const whole = spec.sample?.() ?? made;
    render(
      <EffectCards
        effects={[made]}
        readOnly={false}
        spells={[{ name: 'Misty Step', source: 'XPHB' }]}
        onChange={() => {}}
        moments={[]}
        onMoments={() => {}}
      />,
    );
    const field = spec.fields.find(
      (f) =>
        f.type === 'amount' &&
        (FORMULA_FIELDS[made.kind as keyof typeof FORMULA_FIELDS] ?? []).includes(f.key),
    );
    const expected = [
      ['bloodied', 'concentrating', 'noArmor', 'shield'].some((s) => takes(whole, { while: s })) &&
        'Only while',
      // It grows from a plain number: a formula or a speed of walk is not turned into one.
      field !== undefined &&
        typeof made[field.key] === 'number' &&
        takes(whole, { [field.key]: { byLevel: { 1: 1, 5: 2 } } }) &&
        'Grows with level',
      takes(whole, { edition: '2024' }) && 'Rules version',
      atMoment(whole) && problems(made).length === 0 && 'Counts when',
    ].filter((x): x is string => x !== false);
    expect(offered(spec.add)).toEqual(expected);
  });

  it('offers each kind what the engine reads on it', () => {
    render(
      <EffectCards
        effects={[
          { kind: 'acBonus', amount: 1 },
          { kind: 'grantSpell', spell: 'Misty Step|XPHB' },
          { kind: 'resource', key: 'uses', label: 'Uses', max: 1, reset: 'long' },
          { kind: 'cue', tone: 'info', text: 'Remember to' },
          { kind: 'maxHpBonus', amount: 1 },
        ]}
        readOnly={false}
        spells={[{ name: 'Misty Step', source: 'XPHB' }]}
        onChange={() => {}}
        moments={[]}
        onMoments={() => {}}
      />,
    );
    expect(offered('Armor Class')).toEqual([
      'Only while',
      'Grows with level',
      'Rules version',
      'Counts when',
    ]);
    expect(offered('Cast a spell')).toEqual(['Rules version']);
    expect(offered('Uses per rest')).toEqual(['Grows with level', 'Rules version']);
    expect(offered('Reminder')).toEqual(['Only while', 'Rules version', 'Counts when']);
    expect(offered('Hit points')).toEqual([
      'Only while',
      'Grows with level',
      'Rules version',
      'Counts when',
    ]);
  });

  it('says why where a kind cannot take one', () => {
    render(
      <EffectCards
        effects={[{ kind: 'resource', key: 'uses', label: 'Uses', max: 1, reset: 'long' }]}
        readOnly={false}
        onChange={() => {}}
        moments={[]}
        onMoments={() => {}}
      />,
    );
    expect(offered('Uses per rest')).toEqual(['Grows with level', 'Rules version']);
    fireEvent.click(screen.getByRole('button', { name: 'Counts when' }));
    expect(screen.getByRole('status').textContent).toBe(
      'Counts when is not offered here: a moment can put on numbers and rolls only.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lasts' }));
    expect(screen.getByRole('status').textContent).toMatch(/set Counts when first/);
  });

  it('keeps bloodied from a score and the hit point maximum, as the reader does', () => {
    render(
      <EffectCards
        effects={[
          { kind: 'maxHpBonus', amount: 1 },
          { kind: 'abilityMin', ability: 'str', min: 19 },
          { kind: 'acBonus', amount: 1 },
        ]}
        readOnly={false}
        onChange={() => {}}
      />,
    );
    const states = (label: string) =>
      [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((o) => o.value);
    expect(states('Hit points: When')).not.toContain('bloodied');
    expect(states('Ability score is at least: When')).not.toContain('bloodied');
    expect(states('Armor Class: When')).toContain('bloodied');
  });

  it('offers no moment where the list keeps none, nor in play', () => {
    render(
      <EffectCards
        effects={[{ kind: 'acBonus', amount: 1 }]}
        readOnly={false}
        onChange={() => {}}
      />,
    );
    expect(offered('Armor Class')).toEqual(['Only while', 'Grows with level', 'Rules version']);
    cleanup();
    render(
      <EffectCards
        effects={[{ kind: 'acBonus', amount: 1 }]}
        readOnly={false}
        inPlay
        onChange={() => {}}
      />,
    );
    expect(offered('Armor Class')).toEqual([]);
  });

  it('grows a number by level, from level 1, and takes the table away again', () => {
    let latest: Eff[] = [];
    function List() {
      const [effects, setEffects] = useState<Eff[]>([{ kind: 'acBonus', amount: 1 }]);
      latest = effects;
      return <EffectCards effects={effects} readOnly={false} onChange={setEffects} />;
    }
    render(<List />);
    fireEvent.click(screen.getByRole('button', { name: 'Grows with level' }));
    expect(latest).toEqual([{ kind: 'acBonus', amount: { byLevel: { 1: 1 } } }]);
    fireEvent.click(screen.getByRole('button', { name: 'Armor Class: Add a level' }));
    fireEvent.change(screen.getByLabelText('Armor Class: Amount, row 2'), {
      target: { value: '3' },
    });
    expect(latest).toEqual([{ kind: 'acBonus', amount: { byLevel: { 1: 1, 2: 3 } } }]);
    fireEvent.change(screen.getByLabelText('Armor Class: From level, row 2'), {
      target: { value: '11' },
    });
    expect(latest).toEqual([{ kind: 'acBonus', amount: { byLevel: { 1: 1, 11: 3 } } }]);
    expect(readStoredEffects(latest).problems).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Grows with level' }));
    expect(latest).toEqual([{ kind: 'acBonus', amount: 1 }]);
  });

  it('grows only a plain number, so a formula, a walking speed or a proficiency bonus is kept', () => {
    const fly = SPECS.find((s) => s.add === 'Fly, swim or climb')?.make() as Eff;
    expect(fly.speed).toBe('walk');
    const effects: Eff[] = [
      { kind: 'acBonus', amount: { f: 'prof' } },
      { kind: 'initiativeBonus', profBonus: true },
      fly,
    ];
    let written: unknown;
    render(
      <EffectCards
        effects={effects}
        readOnly={false}
        onChange={(next) => {
          written = next;
        }}
      />,
    );
    for (const title of ['Armor Class', 'Initiative', 'Fly, swim or climb']) {
      expect(offered(title)).not.toContain('Grows with level');
    }
    fireEvent.click(chip('Armor Class', 'Grows with level'));
    expect(written).toBeUndefined();
    expect(screen.getByRole('status').textContent).toBe(
      'Grows with level is not offered here: it grows from a plain number, and this one is not: give it one first.',
    );
  });

  it('shows where a table a file gives starts, and offers later levels only above it', () => {
    render(
      <EffectCards
        effects={[{ kind: 'acBonus', amount: { byLevel: { 5: 1, 11: 2 } } }]}
        readOnly={false}
        onChange={() => {}}
      />,
    );
    expect(chip('Armor Class', 'Grows with level', true)).toBeTruthy();
    expect(screen.getAllByText('5').length).toBeGreaterThan(0);
    const levels = [
      ...(screen.getByLabelText('Armor Class: From level, row 2') as HTMLSelectElement).options,
    ].map((o) => Number(o.value));
    expect(Math.min(...levels)).toBe(6);
    expect(screen.getByRole('button', { name: 'Armor Class: Remove level 11' })).toBeTruthy();
  });
});

/** The feat editor on screen with this guidance; returns the guidance as it stands. */
function featWith(castGuidance: Json) {
  let latest: Json = {};
  const start: Json = { name: 'Fury Feat', ...feat.blank(), castGuidance };
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
      <feat.Body draft={draft} change={change} registry={new EntityRegistry()} readOnly={false} />
    );
  }
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  return () => latest.castGuidance as Json | undefined;
}

const KEPT = [
  { at: 'shortRest', do: [{ kind: 'regain', resource: 'ki', amount: 1 }] },
  {
    at: 'natural20',
    rolls: ['attack'],
    do: [
      { kind: 'addEffect', name: 'Twice', effects: [{ kind: 'acBonus', amount: 1 }] },
      { kind: 'cue', text: 'Roar' },
    ],
  },
];

describe('Counts when and Lasts', () => {
  it('moves a card into a moment and back, leaving every other moment as it was', () => {
    const start = {
      v: 1,
      effects: [
        { kind: 'skillProf', skill: 'stealth' },
        { kind: 'acBonus', amount: 1 },
      ],
      drop: [{ kind: 'resist' }],
      moments: KEPT,
    };
    const guidance = featWith(structuredClone(start));
    expect(screen.getByText(/2 moments do more than put an effect on/)).toBeTruthy();
    // Counts when opens a choice of moment; choosing one moves the card.
    fireEvent.click(chip('Armor Class', 'Counts when'));
    fireEvent.change(screen.getByLabelText('Armor Class: Put on when'), {
      target: { value: 'zeroHp' },
    });
    const moved = {
      at: 'zeroHp',
      do: [{ kind: 'addEffect', name: 'Fury Feat', effects: [{ kind: 'acBonus', amount: 1 }] }],
    };
    expect(guidance()).toEqual({
      ...start,
      effects: [{ kind: 'skillProf', skill: 'stealth' }],
      moments: [...KEPT, moved],
    });
    // In a moment the card holds for as long as it lasts.
    expect(screen.queryByLabelText('Armor Class: When')).toBeNull();
    fireEvent.click(chip('Armor Class', 'Lasts'));
    fireEvent.change(screen.getByLabelText('Armor Class: Lasts'), { target: { value: 'm1' } });
    fireEvent.change(screen.getByLabelText('Armor Class: Ends early'), {
      target: { value: 'unconscious' },
    });
    fireEvent.change(screen.getByLabelText('Armor Class: Put on when'), {
      target: { value: 'castAtLevel' },
    });
    fireEvent.change(screen.getByLabelText('Armor Class: Slot'), { target: { value: '3' } });
    const g = guidance() as { moments: unknown[] };
    expect(g.moments.slice(0, 2)).toEqual(KEPT);
    expect(g.moments[2]).toEqual({
      at: 'castAtLevel',
      level: 3,
      do: [
        {
          ...moved.do[0],
          lasts: { minutes: 1, endsWhen: 'unconscious' },
        },
      ],
    });
    expect(readMoments(g.moments.slice(2), 'Fury Feat').problems).toEqual([]);
    // Back on its own, it counts all the time: what the moment said goes with it.
    fireEvent.click(chip('Armor Class', 'Counts when', true));
    expect(guidance()).toEqual({
      ...start,
      effects: [
        { kind: 'skillProf', skill: 'stealth' },
        { kind: 'acBonus', amount: 1 },
      ],
    });
  });

  it('leaves no empty moments behind', () => {
    const guidance = featWith({ v: 1, effects: [{ kind: 'acBonus', amount: 1 }] });
    fireEvent.click(screen.getByRole('button', { name: 'Counts when' }));
    fireEvent.change(screen.getByLabelText('Armor Class: Put on when'), {
      target: { value: 'longRest' },
    });
    expect(guidance()).toEqual({
      v: 1,
      moments: [
        {
          at: 'longRest',
          do: [{ kind: 'addEffect', name: 'Fury Feat', effects: [{ kind: 'acBonus', amount: 1 }] }],
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove +1 to Armor Class' }));
    expect(guidance()).toBeUndefined();
  });

  it('says what the reader refuses on a card a moment puts on', () => {
    featWith({
      v: 1,
      moments: [
        {
          at: 'zeroHp',
          do: [
            {
              kind: 'addEffect',
              name: 'Odd',
              effects: [{ kind: 'acBonus', amount: 1, while: 'bloodied' }],
            },
          ],
        },
      ],
    });
    expect(
      screen.getByText(/This does not count yet: an effect in play has no "while"/),
    ).toBeTruthy();
    // Its When shows, to take the state away.
    expect((screen.getByLabelText('Armor Class: When') as HTMLSelectElement).value).toBe(
      'bloodied',
    );
  });

  it('puts a card back where it stood, edited in the moment or not', () => {
    const start = {
      v: 1,
      effects: [
        { kind: 'skillProf', skill: 'stealth' },
        { kind: 'acBonus', amount: 1 },
        { kind: 'speedBonus', amount: 10 },
      ],
    };
    const guidance = featWith(structuredClone(start));
    fireEvent.click(chip('Armor Class', 'Counts when'));
    fireEvent.change(screen.getByLabelText('Armor Class: Put on when'), {
      target: { value: 'zeroHp' },
    });
    fireEvent.change(screen.getByLabelText('Armor Class: Amount'), { target: { value: '2' } });
    fireEvent.click(chip('Armor Class', 'Counts when', true));
    expect(guidance()).toEqual({
      v: 1,
      effects: [
        { kind: 'skillProf', skill: 'stealth' },
        { kind: 'acBonus', amount: 2 },
        { kind: 'speedBonus', amount: 10 },
      ],
    });
  });

  it('leaves what was open on a card with it, not with the card that takes its place', () => {
    featWith({
      v: 1,
      effects: [
        { kind: 'acBonus', amount: 1 },
        { kind: 'speedBonus', amount: 10 },
      ],
    });
    fireEvent.click(chip('Armor Class', 'Counts when'));
    fireEvent.change(screen.getByLabelText('Armor Class: Put on when'), {
      target: { value: 'zeroHp' },
    });
    // Speed now stands where Armor Class did.
    expect(chip('Speed', 'Counts when', false)).toBeTruthy();
    expect(screen.queryByLabelText('Speed: Put on when')).toBeNull();
    expect(chip('Armor Class', 'Counts when', true)).toBeTruthy();
  });

  it('leaves what was open on a card taken away with it too', () => {
    featWith({
      v: 1,
      effects: [
        { kind: 'acBonus', amount: 1 },
        { kind: 'speedBonus', amount: 10 },
      ],
    });
    fireEvent.click(chip('Armor Class', 'Counts when'));
    expect(screen.getByLabelText('Armor Class: Put on when')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove +1 to Armor Class' }));
    expect(chip('Speed', 'Counts when', false)).toBeTruthy();
    expect(screen.queryByLabelText('Speed: Put on when')).toBeNull();
  });

  it('grows a number by level on a card a moment puts on, as the moment reader takes it', () => {
    const guidance = featWith({
      v: 1,
      moments: [
        {
          at: 'zeroHp',
          do: [{ kind: 'addEffect', name: 'Fury Feat', effects: [{ kind: 'acBonus', amount: 1 }] }],
        },
      ],
    });
    expect(offered('Armor Class')).toEqual(['Grows with level', 'Counts when', 'Lasts']);
    fireEvent.click(chip('Armor Class', 'Grows with level'));
    const g = guidance() as { moments: unknown[] };
    expect(g.moments).toEqual([
      {
        at: 'zeroHp',
        do: [
          {
            kind: 'addEffect',
            name: 'Fury Feat',
            effects: [{ kind: 'acBonus', amount: { byLevel: { 1: 1 } } }],
          },
        ],
      },
    ]);
    expect(readMoments(g.moments, 'Fury Feat').problems).toEqual([]);
  });

  it('gives each new moment a name of its own, so neither replaces the other', () => {
    const guidance = featWith({
      v: 1,
      effects: [
        { kind: 'acBonus', amount: 1 },
        { kind: 'speedBonus', amount: 10 },
      ],
    });
    for (const title of ['Armor Class', 'Speed']) {
      fireEvent.click(chip(title, 'Counts when'));
      fireEvent.change(screen.getByLabelText(`${title}: Put on when`), {
        target: { value: 'zeroHp' },
      });
    }
    const g = guidance() as { moments: Array<{ do: Array<{ name: string }> }> };
    expect(g.moments.map((m) => m.do[0]?.name)).toEqual(['Fury Feat', 'Fury Feat (2)']);
  });

  it('says nothing is counted only when no moment is kept either', () => {
    featWith({ v: 1, moments: KEPT });
    expect(screen.queryByText(/Nothing for the sheet to count yet/)).toBeNull();
    expect(screen.getByText(/2 moments do more than put an effect on/)).toBeTruthy();
  });

  it('puts no card into moments a file gives as something other than a list', () => {
    const guidance = featWith({ v: 1, effects: [{ kind: 'acBonus', amount: 1 }], moments: 'odd' });
    expect(offered('Armor Class')).not.toContain('Counts when');
    fireEvent.click(chip('Armor Class', 'Counts when'));
    expect((guidance() as Json).moments).toBe('odd');
  });
});

describe('a feat written with Counts when, on a sheet', () => {
  function world(extra: Record<string, DataEntity[]>): EngineContext {
    const base = makeTestContext();
    return {
      get(type, name, source) {
        const hit = (extra[type] ?? []).find(
          (e) =>
            String(e.name).toLowerCase() === name.toLowerCase() &&
            (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
        );
        return hit ?? base.get(type, name, source);
      },
      byType: (type) => [...base.byType(type), ...(extra[type] ?? [])],
    };
  }

  it('puts its effect on when the character drops to 0 hit points', () => {
    const guidance = featWith({ v: 1, effects: [{ kind: 'acBonus', amount: 2 }] });
    fireEvent.click(screen.getByRole('button', { name: 'Counts when' }));
    fireEvent.change(screen.getByLabelText('Armor Class: Put on when'), {
      target: { value: 'zeroHp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lasts' }));
    fireEvent.change(screen.getByLabelText('Armor Class: Lasts'), { target: { value: 'm10' } });
    const entity = {
      name: 'Fury Feat',
      source: 'HB',
      entries: ['Fury.'],
      castGuidance: guidance(),
    } as DataEntity;
    const d = newCharacterDoc('hero', 'Hero', 'test');
    d.abilities.base = { str: 14, dex: 14, con: 14, int: 10, wis: 10, cha: 10 };
    d.classes = [
      { ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: ['avg', 'avg', 'avg', 'avg'] },
    ];
    d.play.hpInitialized = true;
    d.play.currentHp = 20;
    d.feats = [{ ref: { name: 'Fury Feat', source: 'HB' }, instanceId: 'f0' }];
    const sheet = deriveSheet(d, world({ feat: [entity] }));
    expect(sheet.warnings.filter((w) => w.startsWith('Fury Feat'))).toEqual([]);
    expect(sheet.moments?.moments.map((m) => [m.from, m.at])).toEqual([['Fury Feat', 'zeroHp']]);
    const p = d.play;
    knockedOut(p, { maxHp: sheet.maxHp.value, edition: '2024', moments: sheet.moments });
    expect(p.activeEffects?.map((e) => [e.name, e.parts])).toEqual([
      ['Fury Feat', [{ kind: 'acBonus', amount: 2 }]],
    ]);
  });

  it('puts both on when two cards count at the same moment', () => {
    const guidance = featWith({
      v: 1,
      effects: [
        { kind: 'acBonus', amount: 2 },
        { kind: 'speedBonus', amount: 10 },
      ],
    });
    for (const title of ['Armor Class', 'Speed']) {
      fireEvent.click(chip(title, 'Counts when'));
      fireEvent.change(screen.getByLabelText(`${title}: Put on when`), {
        target: { value: 'zeroHp' },
      });
    }
    const entity = {
      name: 'Fury Feat',
      source: 'HB',
      entries: ['Fury.'],
      castGuidance: guidance(),
    } as DataEntity;
    const d = newCharacterDoc('hero', 'Hero', 'test');
    d.classes = [
      { ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: ['avg', 'avg', 'avg', 'avg'] },
    ];
    d.play.hpInitialized = true;
    d.play.currentHp = 20;
    d.feats = [{ ref: { name: 'Fury Feat', source: 'HB' }, instanceId: 'f0' }];
    const sheet = deriveSheet(d, world({ feat: [entity] }));
    const p = d.play;
    knockedOut(p, { maxHp: sheet.maxHp.value, edition: '2024', moments: sheet.moments });
    expect(p.activeEffects?.map((e) => [e.name, e.parts])).toEqual([
      ['Fury Feat', [{ kind: 'acBonus', amount: 2 }]],
      ['Fury Feat (2)', [{ kind: 'speedBonus', amount: 10 }]],
    ]);
  });
});
