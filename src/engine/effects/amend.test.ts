/**
 * A player's price on an action an entry inherits (`amend`, rule pack port 3g):
 * on an entry's own `castGuidance` and on a pack's patch, applied after what the
 * entry inherits and its `drop`, and never to an action its author or a pack
 * wrote. Entries are invented; the spend keys are the shipped rows', whose
 * feature and action names are rule facts.
 */
import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { CAST_GUIDANCE_LIMITS, RULE_PACK_TYPE } from '../castGuidance';
import { linkSpend } from '../curated/spendLinks';
import {
  type ActionCost,
  type CharacterDoc,
  type DataEntity,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { Collector } from './base';
import { mechanicsOf, readMechanics } from './mechanics';

function world(extra: Record<string, DataEntity[]> = {}): EngineContext {
  const base = makeTestContext();
  return {
    get: (type, name, source) => base.get(type, name, source),
    byType: (type) => [...base.byType(type), ...(extra[type] ?? [])],
  };
}

function character(): CharacterDoc {
  const d = newCharacterDoc('hero', 'Hero', 'test');
  d.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: Array(4).fill('avg') }];
  return d;
}

const origin: EffectOrigin = { label: 'Lantern', uid: 'lantern|hb', type: 'feat' };
const cg = (body: Record<string, unknown>): DataEntity => ({
  name: 'Lantern',
  source: 'HB',
  castGuidance: { v: 1, ...body },
});
const pack = (name: string, patches: unknown[]): DataEntity => ({
  name,
  source: name,
  appliesTo: { characters: ['hero'] },
  castGuidance: { v: 1, patches },
});

/** What it inherits: two actions, one priced, and a pool. */
const inheritTwo = (col: Collector, cost: ActionCost = { resource: 'focus', amount: 1 }) => {
  col.add({ kind: 'action', economy: 'bonus', label: 'Flurry of Blows', cost, origin });
  col.add({ kind: 'action', economy: 'action', label: 'Step', origin });
  col.add({ kind: 'resource', key: 'focus', label: 'Focus', max: 4, resetOn: 'short', origin });
};

function collect(
  entry: DataEntity,
  packs: DataEntity[] = [],
  inherited: (col: Collector) => void = inheritTwo,
): Collector {
  const col = new Collector(character(), world({ [RULE_PACK_TYPE]: packs }));
  mechanicsOf(col, {
    entry,
    label: 'Lantern',
    origin,
    target: 'Lantern|HB',
    inherited: () => inherited(col),
  });
  return col;
}

/** Each action's name, price and buy-back, and whether a pack gave it. */
const actions = (col: Collector) =>
  col.effects.flatMap((e) =>
    e.kind === 'action'
      ? [[e.label, e.cost ?? null, e.buyBack ?? null, e.origin.pack ?? e.origin === origin]]
      : [],
  );

const FOCUS_1 = { resource: 'focus', amount: 1 };

describe('reading an amend', () => {
  it('reads a whole price, a new amount, a buy-back and a label', () => {
    const read = readMechanics({
      v: 1,
      amend: [
        { cost: { resource: 'spell-slot', amount: 1, minLevel: 2 } },
        { label: ' Flurry of Blows ', cost: { amount: 2 } },
        { cost: { amount: 'varies' }, buyBack: { resource: 'focus', amount: 1, own: 'step' } },
      ],
    });
    expect(read.problems).toEqual([]);
    expect(read.amend).toEqual([
      { cost: { resource: 'spell-slot', amount: 1, minLevel: 2 } },
      { label: 'Flurry of Blows', cost: { amount: 2 } },
      { cost: { amount: 'varies' }, buyBack: { resource: 'focus', amount: 1, own: 'step' } },
    ]);
  });

  it('leaves out what it cannot read, and says why', () => {
    const read = readMechanics({
      v: 1,
      amend: [
        3,
        { label: 'Step' },
        { cost: { amount: 2, optional: true } },
        { cost: { resource: 'focus', amount: 1, minLevel: 2 } },
        { buyBack: { resource: 'hit-die', amount: 1 } },
        { label: '', cost: FOCUS_1 },
        { cost: FOCUS_1 },
      ],
    });
    expect(read.amend).toEqual([{ cost: FOCUS_1 }]);
    expect(read.problems).toEqual([
      'amend 1: is not a price',
      'amend 2: changes a "cost" or a "buyBack"',
      'amend 3: "cost" with no "resource" changes only "amount", not "optional"',
      'amend 4: "cost.minLevel" is for a price paid with a spell slot',
      'amend 5: "buyBack.resource" is a pool or a spell slot',
      'amend 6: "label" needs words',
    ]);
    expect(readMechanics({ v: 1, amend: {} }).problems).toEqual(['"amend" is not a list']);
  });

  it(`counts the first ${CAST_GUIDANCE_LIMITS.amendsPerEntry}`, () => {
    const many = Array.from({ length: CAST_GUIDANCE_LIMITS.amendsPerEntry + 1 }, () => ({
      cost: FOCUS_1,
    }));
    const read = readMechanics({ v: 1, amend: many });
    expect(read.amend).toHaveLength(CAST_GUIDANCE_LIMITS.amendsPerEntry);
    expect(read.problems).toEqual([
      `only the first ${CAST_GUIDANCE_LIMITS.amendsPerEntry} of "amend" count`,
    ]);
  });
});

describe("an entry's amend", () => {
  it('prices its first inherited action, never its own of that name', () => {
    const col = collect(
      cg({
        effects: [
          {
            kind: 'action',
            economy: 'bonus',
            label: 'Flurry of Blows',
            cost: { resource: 'mine', amount: 3 },
          },
        ],
        amend: [{ cost: { resource: 'ki', amount: 2 }, buyBack: { resource: 'focus', amount: 2 } }],
      }),
    );
    expect(actions(col)).toEqual([
      ['Flurry of Blows', { resource: 'mine', amount: 3 }, null, false],
      ['Flurry of Blows', { resource: 'ki', amount: 2 }, { resource: 'focus', amount: 2 }, true],
      ['Step', null, null, true],
    ]);
    expect(col.warnings).toEqual([]);
  });

  it('with a label, prices each inherited action of that name, in any case', () => {
    const twice = (col: Collector) => {
      inheritTwo(col);
      col.add({ kind: 'action', economy: 'reaction', label: 'STEP', origin });
    };
    const col = collect(cg({ amend: [{ label: 'step', cost: FOCUS_1 }] }), [], twice);
    expect(actions(col)).toEqual([
      ['Flurry of Blows', FOCUS_1, null, true],
      ['Step', FOCUS_1, null, true],
      ['STEP', FOCUS_1, null, true],
    ]);
  });

  it('changes how many it spends of what it spends now, keeping the rest of its price', () => {
    const col = collect(cg({ amend: [{ cost: { amount: 2 } }] }), [], (c) =>
      inheritTwo(c, { resource: 'focus', amount: 1, optional: true, ownUseToo: true }),
    );
    expect(actions(col)[0]?.[1]).toEqual({
      resource: 'focus',
      amount: 2,
      optional: true,
      ownUseToo: true,
    });
  });

  it('says so when a new amount has no pool price to change', () => {
    const slot = { resource: 'spell-slot', amount: 1, minLevel: 2 };
    const col = collect(
      cg({ amend: [{ cost: { amount: 2 } }, { label: 'Step', cost: { amount: 3 } }] }),
      [],
      (c) => inheritTwo(c, slot),
    );
    expect(actions(col).map((a) => a[1])).toEqual([slot, null]);
    expect(col.warnings).toEqual([
      'Lantern: "amend" sets how many it spends, and Flurry of Blows spends no pool\'s uses',
      'Lantern: "amend" sets how many it spends, and Step spends no pool\'s uses',
    ]);
  });

  it('says so when it finds no action it inherits', () => {
    const col = collect(
      cg({ amend: [{ cost: FOCUS_1 }, { label: 'Dash', cost: FOCUS_1 }] }),
      [],
      (c) => c.add({ kind: 'speedBonus', amount: 10, origin }),
    );
    expect(col.warnings).toEqual([
      'Lantern: "amend" finds no action it inherits',
      'Lantern: "amend" finds no action it inherits named "Dash"',
    ]);
  });

  it('prices what is left after its drop, and nothing when it starts from nothing', () => {
    const dropped = collect(
      cg({
        drop: [{ kind: 'action', label: 'Flurry of Blows' }],
        amend: [{ cost: { resource: 'ki', amount: 5 } }],
      }),
    );
    expect(actions(dropped)).toEqual([['Step', { resource: 'ki', amount: 5 }, null, true]]);
    const replaced = collect(cg({ replace: true, amend: [{ cost: FOCUS_1 }] }));
    expect(actions(replaced)).toEqual([]);
    expect(replaced.warnings).toEqual([]);
  });

  it("replaces a spend link's price on the chip it made", () => {
    const col = collect(cg({ amend: [{ cost: { amount: 2 } }] }), [], (c) => {
      c.add({ kind: 'action', economy: 'bonus', label: 'Flurry of Blows', origin });
      linkSpend(c, ['flurry of blows|monk|phb'], 'Flurry of Blows', origin);
    });
    expect(actions(col)).toEqual([
      ['Flurry of Blows', { resource: 'focus', amount: 2 }, null, true],
    ]);
  });

  it('gives each sheet its own copy of a price, read once per entry', () => {
    const entry = cg({
      amend: [{ cost: { resource: 'ki', amount: 2 }, buyBack: { resource: 'ki', amount: 1 } }],
    });
    const first = collect(entry).effects[0];
    if (first?.kind !== 'action' || first.cost === undefined || first.buyBack === undefined)
      throw new Error('no price');
    first.cost.amount = 9;
    first.buyBack.amount = 9;
    expect(actions(collect(entry))[0]).toEqual([
      'Flurry of Blows',
      { resource: 'ki', amount: 2 },
      { resource: 'ki', amount: 1 },
      true,
    ]);
  });
});

describe("a pack's amend", () => {
  const official: DataEntity = { name: 'Lantern', source: 'HB', entries: ['Placeholder.'] };

  it('prices an entry with no castGuidance, never the actions a pack adds', () => {
    const col = collect(official, [
      pack('Gritty', [
        {
          target: 'lantern|hb',
          add: [{ kind: 'action', economy: 'bonus', label: 'Flurry of Blows' }],
          amend: [{ label: 'Flurry of Blows', cost: { amount: 3 } }],
        },
      ]),
    ]);
    expect(actions(col)).toEqual([
      ['Flurry of Blows', null, null, 'Gritty'],
      ['Flurry of Blows', { resource: 'focus', amount: 3 }, null, true],
      ['Step', null, null, true],
    ]);
    expect(col.warnings).toEqual([]);
  });

  it("comes after the entry's own, and a later pack's wins", () => {
    const col = collect(
      cg({ amend: [{ cost: { amount: 2 } }, { label: 'Step', cost: FOCUS_1 }] }),
      [
        pack('One', [{ target: 'LANTERN|HB', amend: [{ cost: { amount: 3 } }] }]),
        pack('Two', [{ target: 'lantern|hb', amend: [{ cost: { amount: 4 } }] }]),
      ],
    );
    expect(actions(col).map((a) => a[1])).toEqual([{ resource: 'focus', amount: 4 }, FOCUS_1]);
  });

  it("says under the pack's name when it finds nothing", () => {
    const col = collect(official, [
      pack('Gritty', [{ target: 'lantern|hb', amend: [{ label: 'Dash', cost: FOCUS_1 }] }]),
    ]);
    expect(col.warnings).toEqual([
      'Gritty: Lantern: "amend" finds no action it inherits named "Dash"',
    ]);
  });

  it('changes nothing beside a replacement, and says so', () => {
    const col = collect(official, [
      pack('Gritty', [{ target: 'lantern|hb', effects: [], amend: [{ cost: FOCUS_1 }] }]),
    ]);
    expect(col.effects).toEqual([]);
    expect(col.warnings).toEqual([
      'Gritty: patch 1 (lantern|hb): "amend" changes nothing beside "effects", which inherit nothing',
    ]);
  });
});

describe("another feature's link on an amended action", () => {
  // Sorcery Incarnate's row buys a use of Innate Sorcery back with Sorcery
  // Points, on Innate Sorcery's action, whatever gave it.
  const innate: EffectOrigin = { label: 'Innate Sorcery', uid: 'innate', type: 'class' };
  const incarnate: EffectOrigin = {
    label: 'Sorcery Incarnate',
    uid: 'incarnate',
    type: 'class',
  };
  const sorcerer = (amend: unknown[]) => {
    const col = new Collector(character(), world());
    mechanicsOf(col, {
      entry: { name: 'Innate Sorcery', source: 'HB', castGuidance: { v: 1, amend } },
      label: 'Innate Sorcery',
      origin: innate,
      target: 'innate',
      inherited: () =>
        col.add({ kind: 'action', economy: 'bonus', label: 'Innate Sorcery', origin: innate }),
    });
    mechanicsOf(col, {
      entry: { name: 'Sorcery Incarnate', source: 'HB' },
      label: 'Sorcery Incarnate',
      origin: incarnate,
      target: 'incarnate',
      inherited: () =>
        linkSpend(col, ['sorcery incarnate|sorcerer|xphb'], 'Sorcery Incarnate', incarnate),
    });
    return col.effects.flatMap((e) =>
      e.kind === 'action' ? [[e.label, e.cost ?? null, e.buyBack]] : [],
    );
  };

  it('leaves a buy-back the player set, and adds no chip of its own', () => {
    expect(sorcerer([{ buyBack: { resource: 'mine', amount: 1 } }])).toEqual([
      ['Innate Sorcery', null, { resource: 'mine', amount: 1 }],
    ]);
  });

  it('still buys back an action whose cost alone the player set', () => {
    expect(sorcerer([{ cost: FOCUS_1 }])).toEqual([
      ['Innate Sorcery', FOCUS_1, { resource: 'sorcery-points', amount: 2 }],
    ]);
  });
});
