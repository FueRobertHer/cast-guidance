// @vitest-environment jsdom
// The Workshop's price card on a copy (rule pack port 3g): it prices what the
// copy inherits, never its own cards, stores only what the reader takes, and
// reaches the sheet and the roll prompt through Save.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import { RULE_SET_TYPE } from '@/engine/castGuidance';
import { deriveSheet } from '@/engine/derive';
import { readMechanics, readStoredEffects } from '@/engine/effects/mechanics';
import { rollEffects } from '@/engine/playRules';
import { type DataEntity, type EngineContext, newCharacterDoc } from '@/engine/types';
import { pricedRollEffects } from '@/features/sheet/rollPrice';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { changeCount, resolveStored, writeEntry } from './copyWriter';
import { amendWords } from './EffectCards';
import { editor as feat } from './editors/FeatEditor';
import { editor as item } from './editors/ItemEditor';
import type { Json } from './editorTypes';
import { FeatureEditor } from './FeatureRow';

afterEach(cleanup);

/** The original a copy is made from: its pool and paid die are its own cards. */
const LANTERN: Json = { name: 'Lantern', source: 'HB', entries: ['It glows.'] };
const POOL = { kind: 'resource', key: 'glow', label: 'Glow', max: 3, reset: 'long' };

/** The feat editor on screen; returns the draft's `castGuidance` as it stands. */
function onScreen(original: Json | undefined, guidance: Json = {}) {
  let latest: Json = {};
  const start: Json = {
    ...feat.blank(),
    name: 'Bright Lantern',
    entries: ['It glows.'],
    castGuidance: { v: 1, ...guidance },
  };
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
      <feat.Body
        draft={draft}
        change={change}
        original={original}
        registry={new EntityRegistry()}
        readOnly={false}
      />
    );
  }
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  return {
    guidance: () => (latest.castGuidance ?? {}) as Json,
    amend: () => ((latest.castGuidance as Json | undefined)?.amend ?? []) as Json[],
    draft: () => latest,
  };
}

const box = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const has = (label: string) => screen.queryByLabelText(label) !== null;
const pick = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const choices = (label: string) => [...box(label).options].map((o) => o.value);
const addPrice = () => fireEvent.click(screen.getByRole('button', { name: /Change its price/ }));

/** Boxes showing a choice other than the value they hold (see paidRollCards.test.tsx). */
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

const problems = (amend: Json[]) => readMechanics({ v: 1, amend }).problems;

/**
 * What a strict reading refuses in a price's whole `cost` or `buyBack`: a field
 * the reader would pass over. A new amount alone (no `resource`) takes only
 * `amount`, which the amend reader checks itself.
 */
function unread(a: Json): string[] {
  const cost = a.cost as Json | undefined;
  const action = {
    kind: 'action',
    economy: 'none',
    label: 'Its action',
    ...(cost !== undefined && cost.resource !== undefined ? { cost } : {}),
    ...(a.buyBack !== undefined ? { buyBack: a.buyBack } : {}),
  };
  return readStoredEffects([action], 'effects', true).problems;
}

describe('where the card is offered', () => {
  it('only on a copy that still does what the original does', () => {
    onScreen(LANTERN);
    expect(screen.getByRole('button', { name: /Change its price/ })).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Also does what Lantern does on the sheet/));
    expect(screen.queryByRole('button', { name: /Change its price/ })).toBeNull();
    cleanup();
    onScreen(undefined);
    expect(screen.queryByRole('button', { name: /Change its price/ })).toBeNull();
  });

  it("not on an item's copy, which inherits no action to price", () => {
    const ring: Json = { name: 'Ring', source: 'HB', ...item.blank() };
    render(
      <MemoryRouter>
        <item.Body
          draft={{ ...ring, name: 'Bright Ring' }}
          change={() => {}}
          original={ring}
          registry={new EntityRegistry()}
          readOnly={false}
        />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/Also does what Ring does on the sheet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Change its price/ })).toBeNull();
  });
});

describe('the price card', () => {
  it('starts as a new amount of what its first action spends now', () => {
    const { amend } = onScreen(LANTERN);
    addPrice();
    expect(amend()).toEqual([{ cost: { amount: 1 } }]);
    expect(box('Price: Spends').value).toBe(':now');
    pick('Price: How many', '2');
    expect(amend()).toEqual([{ cost: { amount: 2 } }]);
    expect(screen.getByText('Its first action, spends 2 uses of its pool')).toBeTruthy();
    expect(problems(amend())).toEqual([]);
    expect(misshown()).toEqual([]);
  });

  it('names the action it prices, or its first when emptied', () => {
    const { amend } = onScreen(LANTERN, { amend: [{ cost: { amount: 2 } }] });
    fireEvent.change(screen.getByLabelText('Price: Action'), {
      target: { value: 'Flurry of Blows' },
    });
    expect(amend()).toEqual([{ cost: { amount: 2 }, label: 'Flurry of Blows' }]);
    fireEvent.change(screen.getByLabelText('Price: Action'), { target: { value: '' } });
    expect(amend()).toEqual([{ cost: { amount: 2 } }]);
  });

  it("offers the copy's own pools and a whole new price, keeping how many", () => {
    const { amend } = onScreen(LANTERN, {
      effects: [POOL],
      amend: [{ cost: { amount: 2 } }],
    });
    expect(choices('Price: Spends')).toEqual(['', ':now', 'glow', 'spell-slot', 'hit-die']);
    pick('Price: Spends', 'glow');
    expect(amend()).toEqual([{ cost: { amount: 2, resource: 'glow' } }]);
    pick('Price: Spends', ':now');
    expect(amend()).toEqual([{ cost: { amount: 2 } }]);
    pick('Price: Spends', 'spell-slot');
    pick('Price: Which slots', '3');
    expect(amend()).toEqual([{ cost: { amount: 1, resource: 'spell-slot', minLevel: 3 } }]);
    expect(has('Price: How many')).toBe(false);
    expect(problems(amend())).toEqual([]);
    expect(misshown()).toEqual([]);
  });

  it("gives a new buy-back no use of its own: an inherited action's pool is not known here", () => {
    const { amend } = onScreen(LANTERN, { effects: [POOL], amend: [{ cost: { amount: 2 } }] });
    // A new amount is the cost's; the buy-back keeps what it has.
    expect(box('Price: Buys back a use with').value).toBe('');
    expect(choices('Price: Buys back a use with')).toEqual(['', 'glow', 'spell-slot']);
    pick('Price: Buys back a use with', 'glow');
    expect(amend()).toEqual([{ cost: { amount: 2 }, buyBack: { resource: 'glow', amount: 1 } }]);
    expect(box('Price: Restores').value).toBe('');
    expect(
      screen.getByText(
        'Its first action, spends 2 uses of its pool, buys a use back with 1 use of glow',
      ),
    ).toBeTruthy();
  });

  it('follows a pool of the copy renamed, in what it spends, buys back with and gives back', () => {
    const glow = {
      cost: { resource: 'glow', amount: 2 },
      buyBack: { resource: 'glow', amount: 1, own: 'glow' },
    };
    const { guidance } = onScreen(LANTERN, { effects: [POOL], amend: [glow] });
    fireEvent.change(screen.getByLabelText('Uses per rest: Name'), { target: { value: 'Ember' } });
    expect(guidance()).toMatchObject({
      effects: [{ kind: 'resource', key: 'ember', label: 'Ember' }],
      amend: [
        {
          cost: { resource: 'ember', amount: 2 },
          buyBack: { resource: 'ember', amount: 1, own: 'ember' },
        },
      ],
    });
    expect(misshown()).toEqual([]);
  });

  it('is cleared by starting from nothing, which leaves no inherited action to price', () => {
    const { guidance } = onScreen(LANTERN, { amend: [{ cost: { amount: 2 } }] });
    fireEvent.click(screen.getByLabelText(/Also does what Lantern does on the sheet/));
    expect(guidance()).toEqual({ v: 1, replace: true });
    fireEvent.click(screen.getByLabelText(/Also does what Lantern does on the sheet/));
    expect(guidance()).toEqual({});
  });

  it('says it counts for nothing with neither price, and is removed by its button', () => {
    const { amend, guidance } = onScreen(LANTERN, { amend: [{ cost: { amount: 2 } }] });
    pick('Price: Spends', '');
    expect(amend()).toEqual([{}]);
    expect(
      screen.getByText(/This does not count yet: changes a "cost" or a "buyBack"/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Its first action, as it is' }));
    // With nothing left to say, the draft keeps no castGuidance at all.
    expect(guidance()).toEqual({});
  });

  it('shows a value no box offers as written, and keeps it', () => {
    const written = { label: 'Rage', cost: { resource: 'rage', amount: 12, ownUseToo: true } };
    const { amend } = onScreen(LANTERN, { amend: [written] });
    expect(misshown()).toEqual([]);
    expect(box('Price: Spends').value).toBe('rage');
    expect(box('Price: How many').value).toBe('12');
    fireEvent.change(screen.getByLabelText('Price: Action'), { target: { value: 'Rage' } });
    expect(amend()).toEqual([written]);
  });

  it('stores only what the reader takes, whatever the boxes are set to', () => {
    // A fixed walk over every box on screen: each step picks one box and one of its choices.
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const { amend } = onScreen(LANTERN, { effects: [POOL], amend: [{ cost: { amount: 1 } }] });
    const seen = new Set<string>();
    for (let step = 0; step < 400; step++) {
      const boxes = screen
        .getAllByRole('combobox')
        .filter((b) => b.getAttribute('aria-label')?.startsWith('Price:'));
      const b = boxes[next(boxes.length)] as HTMLSelectElement;
      const options = [...b.options].map((o) => o.value);
      fireEvent.change(b, { target: { value: options[next(options.length)] } });
      const [a] = amend();
      expect(misshown()).toEqual([]);
      const read = problems(amend());
      // Spends and Buys back both "As it is" is the one card the reader refuses, and says so.
      if (a !== undefined && a.cost === undefined && a.buyBack === undefined) {
        expect(read).toEqual(['amend 1: changes a "cost" or a "buyBack"']);
      } else expect(read).toEqual([]);
      if (a !== undefined) expect(unread(a)).toEqual([]);
      seen.add(JSON.stringify(a));
    }
    // The walk reached prices of every shape: a new amount, a pool, a slot, a die, a buy-back.
    const shapes = [...seen].map((s) => JSON.parse(s) as Json);
    const costOf = (a: Json) => a.cost as Json | undefined;
    expect(shapes.some((a) => costOf(a) !== undefined && costOf(a)?.resource === undefined)).toBe(
      true,
    );
    for (const resource of ['glow', 'spell-slot', 'hit-die']) {
      expect(shapes.some((a) => costOf(a)?.resource === resource)).toBe(true);
    }
    expect(shapes.some((a) => a.buyBack !== undefined)).toBe(true);
  });
});

describe('amendWords', () => {
  it('words each price', () => {
    expect(amendWords({ cost: { amount: 'varies' } } as never)).toBe(
      'Its first action, spends as many uses as you choose of its pool',
    );
    expect(
      amendWords({
        label: ' Rage ',
        cost: { resource: 'rage', amount: 2, optional: true },
      } as never),
    ).toBe('Rage, free, or 2 uses of rage for more');
    // A file's new amount with none given says so in its problem line, not "undefined".
    expect(amendWords({ cost: {} } as never)).toBe('Its first action, spends uses of its pool');
  });
});

describe("a class's or a species' feature", () => {
  /** The feature editor a class, subclass or species copy shows, with its own pool. */
  function feature(castGuidance: Json) {
    let latest: Json = {};
    function Harness() {
      const [value, setValue] = useState<Json>({
        name: 'Flurry of Blows',
        entries: [],
        castGuidance,
      });
      latest = value;
      return (
        <FeatureEditor
          value={value}
          noun="feature"
          onChange={setValue}
          onRename={() => {}}
          readOnly={false}
          withEffects
          inherits="Flurry of Blows"
        />
      );
    }
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    return () => (latest.castGuidance ?? {}) as Json;
  }

  it('prices what it inherits, follows a renamed pool, and is cleared by starting from nothing', () => {
    const guidance = feature({ v: 1, effects: [POOL] });
    addPrice();
    pick('Price: Spends', 'glow');
    expect(guidance().amend).toEqual([{ cost: { amount: 1, resource: 'glow' } }]);
    fireEvent.change(screen.getByLabelText('Uses per rest: Name'), { target: { value: 'Ember' } });
    expect(guidance().amend).toEqual([{ cost: { amount: 1, resource: 'ember' } }]);
    fireEvent.click(screen.getByLabelText(/Also does what Flurry of Blows does on the sheet/));
    expect(guidance()).not.toHaveProperty('amend');
  });
});

describe('Save', () => {
  it('keeps the prices and counts them as a change', () => {
    const draft: Json = {
      ...LANTERN,
      name: 'Bright Lantern',
      castGuidance: { v: 1, amend: [{ cost: { amount: 2 } }] },
    };
    const stored = writeEntry({ original: LANTERN, draft, source: 'MyHomebrew', mode: 'changes' });
    expect((stored.castGuidance as Json).amend).toEqual([{ cost: { amount: 2 } }]);
    const renamed = { ...LANTERN, name: 'Bright Lantern' };
    expect(changeCount(LANTERN, draft)).toBe(changeCount(LANTERN, renamed) + 1);
  });
});

describe('a copy the card prices, on a sheet', () => {
  /** The original's chip: a homebrew spend row gives Lantern a Glow price, as a shipped row would. */
  const spendSet = {
    type: RULE_SET_TYPE,
    v: 1,
    name: 'Homebrew spend links',
    rows: [
      {
        part: 'spend',
        keys: ['lantern|hb'],
        links: [{ cost: { resource: 'glow', amount: 1 }, economy: 'bonus' }],
      },
    ],
  } as DataEntity;
  const PAID = { kind: 'rollPaid', on: { rolls: ['check'] }, dice: '1d4' };

  function sheetOf(copy: Json) {
    const base = makeTestContext();
    const feats = [LANTERN, copy] as DataEntity[];
    const ctx: EngineContext = {
      get: (type, name, source) =>
        (type === 'feat'
          ? feats.find((f) => String(f.name).toLowerCase() === name.toLowerCase())
          : undefined) ?? base.get(type, name, source),
      byType: (type) => [
        ...base.byType(type),
        ...(type === 'feat' ? feats : []),
        ...(type === RULE_SET_TYPE ? [spendSet] : []),
      ],
    };
    const doc = newCharacterDoc('c', 'Hero', 't');
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: [] }];
    doc.feats = [
      { ref: { name: String(copy.name), source: String(copy.source) }, instanceId: 'f0' },
    ];
    return { sheet: deriveSheet(doc, ctx), play: doc.play };
  }

  it("prices the original's chip, and the paid die its use pays for", () => {
    const { draft } = onScreen(LANTERN, { effects: [POOL, PAID] });
    addPrice();
    pick('Price: How many', '2');
    const stored = writeEntry({
      original: LANTERN,
      draft: draft(),
      source: 'MyHomebrew',
      mode: 'changes',
    });
    const { sheet, play } = sheetOf(resolveStored(stored, LANTERN));
    expect(sheet.actions.filter((a) => a.label === 'Bright Lantern').map((a) => a.cost)).toEqual([
      { resource: 'glow', amount: 2 },
    ]);
    const priced = (used: number) =>
      pricedRollEffects(rollEffects(sheet, { kind: 'check', ability: 'str' }), sheet, {
        ...play,
        resources: [{ key: 'glow', used }],
      }).offers;
    expect(priced(0)).toEqual([
      expect.objectContaining({
        source: 'Bright Lantern',
        pay: expect.objectContaining({ spends: [{ key: 'glow', max: 3, amount: 2 }] }),
      }),
    ]);
    // One use left cannot pay two.
    expect(priced(2)).toEqual([]);
  });
});
