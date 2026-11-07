import { describe, expect, it } from 'vitest';
import { SPEND_SKIPPED } from '../../data5e/audit/spendScope';
import { Collector } from '../effects/base';
import { type EffectOrigin, type EngineContext, newCharacterDoc } from '../types';
import { linkSpend, SPEND_LINKS } from './spendLinks';

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

  it('never both links and skips a feature', () => {
    const skipped = Object.values(SPEND_SKIPPED).flatMap((pool) => Object.keys(pool));
    expect(skipped.filter((key) => SPEND_LINKS[key] !== undefined)).toEqual([]);
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
    linkSpend(col, 'Flurry of Blows|Monk|PHB', 'Flurry of Blows', origin);
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
    linkSpend(col, 'trip attack|phb', 'Trip Attack', origin);
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
    linkSpend(paid, "commander's strike|phb", "Commander's Strike", origin);
    expect(paid.effects[0]).toMatchObject({ economy: 'bonus' });
  });

  it('says when the base use is free', () => {
    const col = collector();
    col.add({ kind: 'action', economy: 'bonus', label: 'Patient Defense', origin });
    linkSpend(col, 'patient defense|monk|xphb', 'Patient Defense', origin);
    expect(col.effects[0]).toMatchObject({
      cost: { resource: 'focus', amount: 1, optional: true },
    });
  });

  it('takes the slot the row gives over the one the scanner read', () => {
    const col = collector();
    col.add({ kind: 'action', economy: 'bonus', label: "Nature's Sanctuary", origin });
    linkSpend(col, "nature's sanctuary|circle of the land|xphb", "Nature's Sanctuary", origin);
    expect(col.effects[0]).toMatchObject({ economy: 'action' });
  });

  it("leaves another feature's action alone", () => {
    const col = collector();
    const other: EffectOrigin = { ...origin, label: 'Other' };
    col.add({ kind: 'action', economy: 'bonus', label: 'Other', origin: other });
    linkSpend(col, 'trip attack|phb', 'Trip Attack', origin);
    expect(col.effects[0]).not.toHaveProperty('cost');
    expect(col.effects).toHaveLength(2);
  });

  it('does nothing for a feature outside the table', () => {
    const col = collector();
    linkSpend(col, 'nothing like it|tst', 'Nothing', origin);
    expect(col.effects).toEqual([]);
  });
});
