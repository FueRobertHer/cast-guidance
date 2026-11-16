import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULE_SETS, makeTestContext } from '../../../tests-fixtures/testWorld';
import { RULE_SET_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import { Collector } from '../effects/base';
import { readRuleSet, type SpendLinkRow } from '../effects/mechanics';
import {
  type CharacterDoc,
  type DataEntity,
  type EffectOrigin,
  type EngineContext,
  HIT_DIE_COST,
  newCharacterDoc,
  SLOT_COST,
} from '../types';
import { linkSpend } from './spendLinks';

// As every registry holds them: the built-in rule sets, with every price.
const ctx: EngineContext = {
  get: () => undefined,
  byType: (type) => (type === RULE_SET_TYPE ? BUILT_IN_RULE_SETS : []),
};
const origin: EffectOrigin = { label: 'Feature', uid: 'x', type: 'class' };
const collector = () => new Collector(newCharacterDoc('c', 'H', 't'), ctx);
/** Every key's links in the shipped spend rows. */
const links: ReadonlyArray<readonly [string, SpendLinkRow]> = BUILT_IN_RULE_SETS.flatMap((set) =>
  readRuleSet(set).rows.flatMap((row) =>
    row.part === 'spend'
      ? row.keys.flatMap((key) => (row.links ?? []).map((link) => [key, link] as const))
      : [],
  ),
);
const actionNamed = (col: Collector, label: string) =>
  col.effects.find((e) => e.kind === 'action' && e.label === label);

describe('slot prices in the shipped spend rows', () => {
  // Keys, a slot level, dice and healing, and SPEND_SKIPPED, are checked for
  // every price in `spendLinks.test.ts`.

  it('rolls a 2014 smite as the rules say at each slot level', () => {
    const smite = links.find(([key]) => key === 'divine smite|paladin|phb')?.[1];
    expect(smite !== undefined && 'cost' in smite && smite.cost.slotDice).toEqual({
      die: 8,
      base: 1,
      maxDice: 5,
    });
    const col = collector();
    linkSpend(col, ['eldritch smite|xphb'], 'Eldritch Smite', origin);
    expect(actionNamed(col, 'Eldritch Smite')).toMatchObject({
      cost: { pactOnly: true, slotDice: { die: 8, base: 1 } },
    });
  });

  it('keeps a Pact Magic buy-back to the three 2024 patrons that say so', () => {
    const pact = links
      .filter(([, link]) => 'buyBack' in link && link.buyBack.pactOnly === true)
      .map(([key]) => key)
      .sort();
    expect(pact).toEqual([
      'beguiling defenses|archfey patron|xphb',
      'clairvoyant combatant|great old one patron|xphb',
      'hurl through hell|fiend patron|xphb',
    ]);
  });
});

describe('linkSpend with a slot or Hit Point Die row', () => {
  it('hangs a slot cost on the action the feature emitted', () => {
    const col = collector();
    col.add({ kind: 'action', economy: 'reaction', label: 'Song of Defense', origin });
    linkSpend(col, ['song of defense|bladesinging|tce'], 'Song of Defense', origin);
    expect(col.effects).toEqual([
      {
        kind: 'action',
        economy: 'reaction',
        label: 'Song of Defense',
        cost: { resource: SLOT_COST, amount: 1 },
        note: '5 less damage a slot level',
        origin,
      },
    ]);
  });

  it('adds a rider for a smite, which has no action of its own', () => {
    const col = collector();
    expect(linkSpend(col, ['divine smite|paladin|phb'], 'Divine Smite', origin)).toBe(true);
    expect(col.effects).toEqual([
      {
        kind: 'action',
        economy: 'none',
        label: 'Divine Smite',
        cost: {
          resource: SLOT_COST,
          amount: 1,
          slotDice: { die: 8, base: 1, maxDice: 5 },
        },
        origin,
        note: '1d8 more against an undead or fiend',
      },
    ]);
  });

  it("keeps a pool's cost on its chip and gives the slot's its own (Combat Wild Shape)", () => {
    const col = collector();
    col.add({ kind: 'action', economy: 'bonus', label: 'Combat Wild Shape', origin });
    linkSpend(col, ['combat wild shape|circle of the moon|phb'], 'Combat Wild Shape', origin);
    expect(actionNamed(col, 'Combat Wild Shape')).toMatchObject({
      cost: { resource: 'wild-shape', amount: 1, optional: true },
    });
    expect(actionNamed(col, 'Combat Wild Shape healing')).toMatchObject({
      economy: 'bonus',
      cost: { resource: SLOT_COST, slotDice: { die: 8, base: 0, heals: true } },
    });
  });

  it("buys back the feature's own use with a slot of the level it names", () => {
    const col = collector();
    col.add({ kind: 'action', economy: 'bonus', label: 'Holy Nimbus', origin });
    linkSpend(col, ['holy nimbus|oath of devotion|xphb'], 'Holy Nimbus', origin);
    expect(actionNamed(col, 'Holy Nimbus')).toMatchObject({
      buyBack: { resource: SLOT_COST, amount: 1, minLevel: 5 },
    });
    expect(actionNamed(col, 'Holy Nimbus')).not.toHaveProperty('cost');
  });

  it('keeps a pool cost and adds a slot buy-back on the same chip (Divine Reaper)', () => {
    const col = collector();
    linkSpend(col, ['divine reaper|grave domain|rhw'], 'Divine Reaper', origin);
    expect(actionNamed(col, 'Divine Reaper')).toMatchObject({
      cost: { resource: 'channel-divinity', amount: 1 },
      buyBack: { resource: SLOT_COST, amount: 1, minLevel: 6 },
    });
  });

  it("restores another pool's use on that pool's chip, and adds none without it", () => {
    const col = collector();
    const bardic: EffectOrigin = { ...origin, label: 'Bardic Inspiration' };
    col.add({ kind: 'action', economy: 'bonus', label: 'Bardic Inspiration', origin: bardic });
    linkSpend(col, ['font of inspiration|bard|xphb'], 'Font of Inspiration', origin);
    expect(col.effects).toHaveLength(1);
    expect(actionNamed(col, 'Bardic Inspiration')).toMatchObject({
      buyBack: { resource: SLOT_COST, amount: 1, own: 'bardic-inspiration' },
    });
    const alone = collector();
    linkSpend(alone, ['font of inspiration|bard|xphb'], 'Font of Inspiration', origin);
    expect(alone.effects).toEqual([]);
  });

  it('spends a Hit Point Die, with a use of the feature where it counts them', () => {
    const col = collector();
    col.add({ kind: 'action', economy: 'bonus', label: 'Light Bringer', origin });
    linkSpend(col, ['light bringer|abh'], 'Light Bringer', origin);
    expect(actionNamed(col, 'Light Bringer')).toMatchObject({
      cost: { resource: HIT_DIE_COST, amount: 1, hitDieHeals: 'roll', ownUseToo: true },
    });
    const dwarf = collector();
    linkSpend(dwarf, ['dwarven fortitude|xge'], 'Dwarven Fortitude', origin);
    expect(dwarf.effects).toEqual([
      {
        kind: 'action',
        economy: 'none',
        label: 'Dwarven Fortitude',
        cost: { resource: HIT_DIE_COST, amount: 1, hitDieHeals: 'rollPlusCon', hitDieAtLeast: 1 },
        origin,
      },
    ]);
  });
});

describe('a slot or Hit Point Die cost through deriveSheet', () => {
  // Two feats the table names, with placeholder prose, beside the synthetic world.
  const FEATS: DataEntity[] = [
    { name: 'Adept of the White Robes', source: 'DSotDQ', entries: ['Placeholder text.'] },
    { name: 'Dwarven Fortitude', source: 'XGE', entries: ['Placeholder text.'] },
  ];
  const world = makeTestContext();
  const withFeats: EngineContext = {
    get: (type, name, source) =>
      type === 'feat'
        ? FEATS.find(
            (f) =>
              String(f.name).toLowerCase() === name.toLowerCase() &&
              (source === undefined || String(f.source).toLowerCase() === source.toLowerCase()),
          )
        : world.get(type, name, source),
    byType: (type) => (type === 'feat' ? FEATS : world.byType(type)),
  };
  /** A level 3 Warrior with both feats, and five Sorcerer levels when `casts`. */
  const derive = (casts: boolean) => {
    const doc: CharacterDoc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: [] }];
    if (casts) doc.classes.push({ ref: { name: 'Sorcerer', source: 'TST' }, levels: 5, hp: [] });
    doc.feats = FEATS.map((f, i) => ({
      ref: { name: String(f.name), source: String(f.source) },
      instanceId: `f${String(i)}`,
    }));
    return deriveSheet(doc, withFeats).actions;
  };

  it('keeps a slot price on a caster, and a Hit Point Die price on anyone', () => {
    const actions = derive(true);
    expect(actions.find((a) => a.label === 'Adept of the White Robes')?.cost).toMatchObject({
      resource: SLOT_COST,
    });
    expect(actions.find((a) => a.label === 'Dwarven Fortitude')?.cost).toMatchObject({
      resource: HIT_DIE_COST,
      hitDieHeals: 'rollPlusCon',
    });
  });

  it('drops a slot price the sheet has no slot to pay', () => {
    const actions = derive(false);
    const adept = actions.find((a) => a.label === 'Adept of the White Robes');
    expect(adept).toBeDefined();
    expect(adept?.cost).toBeUndefined();
    expect(actions.find((a) => a.label === 'Dwarven Fortitude')?.cost?.resource).toBe(HIT_DIE_COST);
  });
});
