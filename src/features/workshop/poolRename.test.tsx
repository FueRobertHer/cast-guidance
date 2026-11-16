// @vitest-environment jsdom
// Renaming one of an entry's own pools in the Workshop: what spends it follows
// its name as it is typed (an action's cost and buy-back, a spell cast with its
// uses, the same pool given for the other rules version, a price on what a copy
// inherits), and nothing else does, though its key passes through another
// pool's on the way. The prices on what a copy inherits alone are in
// amendCards.test.tsx.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import type { StoredEffect } from '@/engine/castGuidance';

vi.mock('@/data5e/hooks', () => ({
  useTypePacks: () => ({ status: 'ready', error: null, offline: false, retry: () => undefined }),
}));

import { editor as item } from './editors/ItemEditor';
import type { Json } from './editorTypes';
import { FeatureEditor } from './FeatureRow';

afterEach(cleanup);

const POOL = { kind: 'resource', key: 'glow', label: 'Glow', max: 3, reset: 'long' };
/** A class's Ki: a pool a feature's cards can spend, though the feature does not give it. */
const KI = { kind: 'resource', key: 'ki', label: 'Ki', max: 2, reset: 'short' };

/** What spends `pool` in each field that names one: a cost and buy-back, a slot's refill, a spell. */
const spenders = (pool: string, label: string): Json[] => [
  {
    kind: 'action',
    economy: 'bonus',
    label,
    cost: { resource: pool, amount: 1 },
    buyBack: { resource: pool, amount: 1, own: pool },
  },
  {
    kind: 'action',
    economy: 'action',
    label: `${label} Slot`,
    cost: { resource: 'spell-slot', amount: 1, slotRefills: pool },
  },
  { kind: 'grantSpell', spell: 'shield|phb', resourceKey: pool },
];

/** A class or species feature's editor, as a copy shows it; returns its `castGuidance`. */
function feature(castGuidance: Json, resources?: StoredEffect[]) {
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
        resources={resources}
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

/** An item's editor, which prices nothing it inherits; returns its effects. */
function anItem(effects: Json[]) {
  let latest: Json = {};
  function Harness() {
    const [draft, setDraft] = useState<Json>({
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: { v: 1, effects },
    });
    latest = draft;
    return (
      <item.Body
        draft={draft}
        change={(patch) => setDraft((d) => ({ ...d, ...patch }))}
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
  return () => ((latest.castGuidance as Json | undefined)?.effects ?? []) as Json[];
}

/** Types `value` into the name box of the `n`th pool card. */
const name = (value: string, n = 0) =>
  fireEvent.change(screen.getAllByLabelText('Uses per rest: Name')[n] as HTMLElement, {
    target: { value },
  });

describe("renaming a feature's pool", () => {
  it("moves only its own pool's spenders while its name is typed, through a class pool's key", () => {
    const onKi = { cost: { resource: 'ki', amount: 2 } };
    const guidance = feature(
      {
        v: 1,
        effects: [POOL, ...spenders('ki', 'Flurry'), ...spenders('glow', 'Flare')],
        amend: [onKi, { cost: { resource: 'glow', amount: 1 } }],
      },
      [KI as StoredEffect],
    );
    // Typed a letter at a time, its key is ki between Ki and Kin.
    for (const value of ['K', 'Ki', 'Kin', 'Kindle']) name(value);
    expect(guidance()).toEqual({
      v: 1,
      effects: [
        { ...POOL, key: 'kindle', label: 'Kindle' },
        ...spenders('ki', 'Flurry'),
        ...spenders('kindle', 'Flare'),
      ],
      amend: [onKi, { cost: { resource: 'kindle', amount: 1 } }],
    });
    // A spender set on it between two renames follows the next one too.
    fireEvent.change(screen.getAllByLabelText('Action: Spends')[0] as HTMLElement, {
      target: { value: 'kindle' },
    });
    name('Ember');
    const [flurry, ...rest] = spenders('ki', 'Flurry');
    expect(guidance().effects).toEqual([
      { ...POOL, key: 'ember', label: 'Ember' },
      { ...flurry, cost: { resource: 'ember', amount: 1 } },
      ...rest,
      ...spenders('ember', 'Flare'),
    ]);
  });

  it('keeps the same rename through a letter that leaves its key as it is', () => {
    const guidance = feature(
      { v: 1, effects: [POOL, ...spenders('ki', 'Flurry'), ...spenders('glow', 'Flare')] },
      [KI as StoredEffect],
    );
    // "Ki " is keyed ki too, so the key stays on the class's for two letters.
    for (const value of ['K', 'Ki', 'Ki ', 'Ki P', 'Ki Points']) name(value);
    expect(guidance().effects).toEqual([
      { ...POOL, key: 'ki-points', label: 'Ki Points' },
      ...spenders('ki', 'Flurry'),
      ...spenders('ki-points', 'Flare'),
    ]);
  });

  it('keeps the same rename for a pool a file gives no key, which its name gives one', () => {
    const { key: _, ...keyless } = POOL;
    const guidance = feature({ v: 1, effects: [keyless, ...spenders('ki', 'Flurry')] }, [
      KI as StoredEffect,
    ]);
    for (const value of ['Ki', 'Ki ', 'Ki P', 'Ki Points']) name(value);
    expect(guidance().effects).toEqual([
      { ...keyless, key: 'ki-points', label: 'Ki Points' },
      ...spenders('ki', 'Flurry'),
    ]);
  });

  it('moves the spenders of each pool renamed in turn', () => {
    const sparks = { ...POOL, key: 'sparks', label: 'Sparks' };
    const guidance = feature({
      v: 1,
      effects: [POOL, sparks, ...spenders('glow', 'Flare'), ...spenders('sparks', 'Spark')],
    });
    name('Ember', 0);
    name('Flash', 1);
    expect(guidance().effects).toEqual([
      { ...POOL, key: 'ember', label: 'Ember' },
      { ...sparks, key: 'flash', label: 'Flash' },
      ...spenders('ember', 'Flare'),
      ...spenders('flash', 'Spark'),
    ]);
  });
});

describe("renaming an item's pool", () => {
  it('leaves a pool of its own that the name passes through, and moves its twin', () => {
    const now = { ...POOL, edition: '2024' };
    const then = { ...POOL, edition: '2014', max: 2 };
    const effects = anItem([
      now,
      then,
      KI,
      ...spenders('ki', 'Flurry'),
      ...spenders('glow', 'Flare'),
    ]);
    for (const value of ['K', 'Ki', 'Kin', 'Kindle']) name(value);
    expect(effects()).toEqual([
      { ...now, key: 'kindle', label: 'Kindle' },
      { ...then, key: 'kindle', label: 'Kindle' },
      KI,
      ...spenders('ki', 'Flurry'),
      ...spenders('kindle', 'Flare'),
    ]);
  });

  it('renames a pool named for another as one with it, with what spends them', () => {
    const uses = { ...POOL, key: 'uses', label: 'Uses' };
    const effects = anItem([KI, ...spenders('ki', 'Flurry'), uses, ...spenders('uses', 'Flare')]);
    // A new pool named Ki is the same pool as Ki, so renaming Ki next moves it all.
    name('Ki', 1);
    name('Ki Points', 0);
    expect(effects()).toEqual([
      { ...KI, key: 'ki-points', label: 'Ki Points' },
      ...spenders('ki-points', 'Flurry'),
      { ...uses, key: 'ki-points', label: 'Ki Points' },
      ...spenders('ki-points', 'Flare'),
    ]);
  });

  it("moves no pool's key, spell's uses or price a file gives another card, nor its name", () => {
    // Fields no action has: only a pool has a key, and only a spell the uses it is cast with.
    const stray = {
      kind: 'action',
      economy: 'bonus',
      label: 'Flare',
      key: 'glow',
      resourceKey: 'glow',
    };
    // Nor a price on a card that is not an action.
    const note = { kind: 'note', text: 'It glows.', cost: { resource: 'glow', amount: 1 } };
    const effects = anItem([POOL, stray, note]);
    name('Ember');
    expect(effects()).toEqual([{ ...POOL, key: 'ember', label: 'Ember' }, stray, note]);
  });

  it('keeps twins typed in turn one pool', () => {
    // A price a file gives the pool itself is no action's, and stays put.
    const now = { ...POOL, edition: '2024', cost: { resource: 'glow', amount: 1 } };
    const then = { ...POOL, edition: '2014', max: 2 };
    const effects = anItem([now, then, ...spenders('glow', 'Flare')]);
    // A letter typed in one twin's name, the next in the other's.
    name('Glo', 0);
    name('Gl', 1);
    expect(effects()).toEqual([
      { ...now, key: 'gl', label: 'Gl' },
      { ...then, key: 'gl', label: 'Gl' },
      ...spenders('gl', 'Flare'),
    ]);
  });
});
