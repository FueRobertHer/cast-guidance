import { describe, expect, it } from 'vitest';
import { SPEND_POOLS, SPEND_SKIPPED } from '../../data5e/audit/spendScope';
import { RULE_SET_TYPE } from '../castGuidance';
import { Collector } from '../effects/base';
import { readRuleSet } from '../effects/mechanics';
import { type EffectInput, type EffectOrigin, type EngineContext, newCharacterDoc } from '../types';
import { SLOT_LINKS } from './slotLinks';
import { codeLinksOf, linkCodeRows, linkPrice, linkSpend, SPEND_LINKS } from './spendLinks';

const ctx: EngineContext = { get: () => undefined, byType: () => [] };
const origin: EffectOrigin = { label: 'Feature', uid: 'x', type: 'class' };
const collector = () => new Collector(newCharacterDoc('c', 'H', 't'), ctx);
const rows = Object.entries(SPEND_LINKS);

describe('SPEND_LINKS', () => {
  it('keys every row by lowercase name and printing', () => {
    for (const [key] of rows) {
      expect(key, key).toBe(key.toLowerCase());
      expect(key.split('|').length, key).toBeGreaterThanOrEqual(2);
    }
  });

  it('spends a whole positive number, or leaves it to the player', () => {
    for (const [key, link] of rows) {
      if (link.amount === 'varies') continue;
      expect(Number.isInteger(link.amount) && link.amount > 0, key).toBe(true);
    }
  });

  it('only pays for more on a use that does something for free', () => {
    // A rider has no turn to mark, so its free base use would be a button that does nothing.
    for (const [key, link] of rows) {
      if (link.optional !== true) continue;
      expect(link.economy, key).not.toBe('none');
      expect(link.amount, key).not.toBe('varies');
    }
  });

  it('never both links and skips a feature for one pool', () => {
    // A feature can name several: Twinned Spell spends Sorcery Points and names a slot's level.
    const both = SPEND_POOLS.flatMap((pool) =>
      Object.keys(SPEND_SKIPPED[pool.id] ?? {}).filter((key) => {
        const link = SPEND_LINKS[key];
        return link !== undefined && pool.resources.includes(link.resource);
      }),
    );
    expect(both).toEqual([]);
  });

  it('gives its reasons to pools that exist', () => {
    const ids = SPEND_POOLS.map((pool) => pool.id);
    expect(Object.keys(SPEND_SKIPPED).filter((id) => !ids.includes(id))).toEqual([]);
  });

  it("leaves out an oath's Channel Divinity heading only where its options have rows", () => {
    const headings = Object.keys(SPEND_SKIPPED.channel ?? {}).filter((key) =>
      key.startsWith('channel divinity|oath'),
    );
    expect(headings).toHaveLength(9);
    for (const key of headings) {
      const [, subclass, source] = key.split('|');
      const options = rows.filter(
        ([row, link]) =>
          row.endsWith(`|${subclass}|${source}`) && link.resource === 'channel-divinity-paladin',
      );
      expect(options.length, key).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the printings apart where their costs differ', () => {
    expect(SPEND_LINKS['heightened spell|phb']?.amount).toBe(3);
    expect(SPEND_LINKS['heightened spell|xphb']?.amount).toBe(2);
    expect(SPEND_LINKS['twinned spell|phb']?.amount).toBe('varies');
    expect(SPEND_LINKS['twinned spell|xphb']?.amount).toBe(1);
    expect(SPEND_LINKS['patient defense|monk|phb']?.optional).toBeUndefined();
    expect(SPEND_LINKS['patient defense|monk|xphb']?.optional).toBe(true);
  });

  it('covers the cases that spent nothing', () => {
    const pool = (key: string) => SPEND_LINKS[key]?.resource;
    expect(pool('cutting words|college of lore|phb')).toBe('bardic-inspiration');
    expect(pool('cutting words|college of lore|xphb')).toBe('bardic-inspiration');
    expect(pool('flurry of blows|monk|xphb')).toBe('focus');
    expect(pool('stunning strike|monk|xphb')).toBe('focus');
    expect(pool('turn undead|cleric|xphb')).toBe('channel-divinity');
    expect(pool('preserve life|life domain|xphb')).toBe('channel-divinity');
    expect(pool('starry form|circle of the stars|xphb')).toBe('wild-shape');
  });
});

describe('linkSpend', () => {
  it('hangs the cost on the action the feature already emitted', () => {
    const col = collector();
    col.add({ kind: 'action', economy: 'bonus', label: 'Flurry of Blows', origin });
    linkSpend(col, ['Flurry of Blows|Monk|PHB'], 'Flurry of Blows', origin);
    expect(col.effects).toEqual([
      {
        kind: 'action',
        economy: 'bonus',
        label: 'Flurry of Blows',
        cost: { resource: 'focus', amount: 1 },
        origin,
      },
    ]);
  });

  it('adds an action for a feature that has none, taking no slot unless the row gives one', () => {
    const col = collector();
    linkSpend(col, ['trip attack|phb'], 'Trip Attack', origin);
    expect(col.effects).toEqual([
      {
        kind: 'action',
        economy: 'none',
        label: 'Trip Attack',
        cost: { resource: 'superiority-dice', amount: 1 },
        origin,
      },
    ]);
    const paid = collector();
    linkSpend(paid, ["commander's strike|phb"], "Commander's Strike", origin);
    expect(paid.effects[0]).toMatchObject({ economy: 'bonus' });
  });

  it('says when the base use is free', () => {
    const col = collector();
    col.add({ kind: 'action', economy: 'bonus', label: 'Patient Defense', origin });
    linkSpend(col, ['patient defense|monk|xphb'], 'Patient Defense', origin);
    expect(col.effects[0]).toMatchObject({
      cost: { resource: 'focus', amount: 1, optional: true },
    });
  });

  it('takes the slot the row gives over the one the scanner read', () => {
    const col = collector();
    col.add({ kind: 'action', economy: 'bonus', label: "Nature's Sanctuary", origin });
    linkSpend(col, ["nature's sanctuary|circle of the land|xphb"], "Nature's Sanctuary", origin);
    expect(col.effects[0]).toMatchObject({ economy: 'action' });
  });

  it("leaves another feature's action alone", () => {
    const col = collector();
    const other: EffectOrigin = { ...origin, label: 'Other' };
    col.add({ kind: 'action', economy: 'bonus', label: 'Other', origin: other });
    linkSpend(col, ['trip attack|phb'], 'Trip Attack', origin);
    expect(col.effects[0]).not.toHaveProperty('cost');
    expect(col.effects).toHaveLength(2);
  });

  describe('a buy-back row', () => {
    const buyBackOf = (col: Collector, label: string) =>
      col.effects.find((e) => e.kind === 'action' && e.label === label);

    it('hangs on the action the feature emitted, with no cost and the same slot', () => {
      const col = collector();
      col.add({ kind: 'action', economy: 'bonus', label: 'Psi-Powered Leap', origin });
      linkSpend(col, ['psi-powered leap|psi warrior|xphb'], 'Psi-Powered Leap', origin);
      expect(col.effects).toEqual([
        {
          kind: 'action',
          economy: 'bonus',
          label: 'Psi-Powered Leap',
          buyBack: { resource: 'psi-warrior-dice', amount: 1 },
          origin,
        },
      ]);
    });

    it('adds a chip that takes no slot for a feature with no action', () => {
      const col = collector();
      linkSpend(col, ['rend mind|soulknife|xphb'], 'Rend Mind', origin);
      expect(col.effects).toEqual([
        {
          kind: 'action',
          economy: 'none',
          label: 'Rend Mind',
          buyBack: { resource: 'soulknife-dice', amount: 3 },
          origin,
        },
      ]);
    });

    it('points at the use when it sits on another row', () => {
      const col = collector();
      const psi: EffectOrigin = { label: 'Psi Warrior', uid: 'psi warrior|tce', type: 'subclass' };
      col.add({ kind: 'action', economy: 'bonus', label: 'Telekinetic Master', origin: psi });
      linkSpend(col, ['telekinetic master|psi warrior|tce'], 'Telekinetic Master', psi);
      expect(buyBackOf(col, 'Telekinetic Master')).toMatchObject({
        buyBack: {
          resource: 'psi-warrior-dice',
          amount: 1,
          own: 'spell:psi warrior|tce:telekinesis',
        },
      });
    });

    it("hangs on another feature's action when the row names it", () => {
      const col = collector();
      const other: EffectOrigin = { ...origin, label: 'Innate Sorcery' };
      col.add({ kind: 'action', economy: 'bonus', label: 'Innate Sorcery', origin: other });
      linkSpend(col, ['sorcery incarnate|sorcerer|xphb'], 'Sorcery Incarnate', origin);
      expect(col.effects).toHaveLength(1);
      expect(buyBackOf(col, 'Innate Sorcery')).toMatchObject({
        buyBack: { resource: 'sorcery-points', amount: 2 },
      });
    });

    it('counts the uses when the row says so, under the name of the feature', () => {
      const col = collector();
      col.add({ kind: 'action', economy: 'bonus', label: 'Aspect of the Wyrm', origin });
      linkSpend(
        col,
        ['aspect of the wyrm|way of the ascendant dragon|ftd'],
        'Aspect of the Wyrm',
        origin,
      );
      expect(col.effects).toContainEqual({
        kind: 'resource',
        key: 'aspect-of-the-wyrm',
        label: 'Aspect of the Wyrm',
        max: 1,
        resetOn: 'long',
        origin,
      });
    });
  });

  it('does nothing for a feature outside the table', () => {
    const col = collector();
    linkSpend(col, ['nothing like it|tst'], 'Nothing', origin);
    expect(col.effects).toEqual([]);
  });
});

describe('a built-in spend row stands in for the code rows of its key (rule pack port 3b)', () => {
  const keys = [...new Set([...Object.keys(SPEND_LINKS), ...Object.keys(SLOT_LINKS)])].sort();
  // Every code row, as the links a moved row would hold, read as the app reads its files.
  const read = readRuleSet(
    JSON.parse(
      JSON.stringify({
        type: RULE_SET_TYPE,
        v: 1,
        name: 'Every link',
        rows: keys.map((key) => ({ part: 'spend', keys: [key], links: codeLinksOf(key) })),
      }),
    ),
  );
  const linksOf = new Map(read.rows.map((r) => [r.keys[0], r.links ?? []]));

  /** What a feature may have emitted before its links run: by its own origin, or another's. */
  type Seed = (add: (e: EffectInput) => void, own: EffectOrigin, onAction: string) => void;
  const other: EffectOrigin = { label: 'Another', uid: 'another', type: 'class' };
  const pool = { resource: 'other-pool', amount: 2 };
  const SEEDS: Record<string, Seed> = {
    'no action': () => {},
    'an action': (add, own) =>
      add({ kind: 'action', economy: 'bonus', label: 'Feature', origin: own }),
    'an action with a cost': (add, own) =>
      add({ kind: 'action', economy: 'bonus', label: 'Feature', cost: pool, origin: own }),
    'an action with a buy-back': (add, own) =>
      add({ kind: 'action', economy: 'bonus', label: 'Feature', buyBack: pool, origin: own }),
    'an action with a note': (add, own) =>
      add({ kind: 'action', economy: 'bonus', label: 'Feature', note: 'A note.', origin: own }),
    'two actions': (add, own) => {
      add({ kind: 'action', economy: 'reaction', label: 'Feature', origin: own });
      add({ kind: 'action', economy: 'bonus', label: 'Feature Two', cost: pool, origin: own });
    },
    "another feature's action it names": (add, _own, onAction) =>
      add({ kind: 'action', economy: 'bonus', label: onAction, origin: other }),
    "another feature's action it names, with a buy-back": (add, _own, onAction) =>
      add({ kind: 'action', economy: 'bonus', label: onAction, buyBack: pool, origin: other }),
    both: (add, own, onAction) => {
      add({ kind: 'action', economy: 'action', label: onAction, origin: other });
      add({ kind: 'action', economy: 'bonus', label: 'Feature', cost: pool, origin: own });
    },
  };

  it('reads every code row as links', () => {
    expect(read.problems).toEqual([]);
    expect(read.rows).toHaveLength(keys.length);
    // 299 pool rows and 57 slot rows, two keys in both.
    expect(keys).toHaveLength(299 + 57 - 2);
  });

  it('pays with a pool in SPEND_LINKS and with a slot or a die in SLOT_LINKS alone', () => {
    // How a link applies turns on how its price is paid (`linkPrice`).
    const slotOrDie = (r: string) => r === 'spell-slot' || r === 'hit-die';
    expect(
      Object.keys(SPEND_LINKS).filter((k) => slotOrDie(SPEND_LINKS[k]?.resource ?? '')),
    ).toEqual([]);
    expect(
      Object.entries(SLOT_LINKS).filter(([, row]) =>
        row.kind === 'spend' ? !slotOrDie(row.cost.resource) : false,
      ),
    ).toEqual([]);
  });

  it('puts the same effects on the sheet as the code rows, field for field', () => {
    const differ: string[] = [];
    for (const key of keys) {
      const links = linksOf.get(key) ?? [];
      const onAction =
        links.flatMap((l) => ('buyBack' in l && l.onAction !== undefined ? [l.onAction] : []))[0] ??
        'Another Feature';
      for (const [state, seed] of Object.entries(SEEDS)) {
        const run = (link: (col: Collector, own: EffectOrigin) => void) => {
          const col = collector();
          const own: EffectOrigin = { label: 'Feature', uid: 'feature|tst', type: 'class' };
          seed((e) => col.add(e), own, onAction);
          link(col, own);
          return JSON.stringify(col.effects);
        };
        const code = run((col, own) => linkCodeRows(col, key, 'Feature', own));
        const data = run((col, own) => {
          for (const link of links) linkPrice(col, link, 'Feature', own);
        });
        if (code !== data) differ.push(`${key} [${state}]`);
      }
    }
    expect(differ).toEqual([]);
  });
});
