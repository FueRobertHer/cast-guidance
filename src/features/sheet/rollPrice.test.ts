import { describe, expect, it } from 'vitest';
import type { RollEffects } from '@/engine/playRules';
import type { DerivedResource, DerivedSheet, PlayState } from '@/engine/types';
import { offerPrice, payOffer, pricedRollEffects, refundOffer } from './rollPrice';

type SheetAction = DerivedSheet['actions'][number];

const resource = (
  key: string,
  label: string,
  max: number,
  extra: Partial<DerivedResource> = {},
): DerivedResource => ({ key, label, max, resetOn: 'short', origin: 'Battle Master', ...extra });
const action = (extra: Partial<SheetAction>): SheetAction =>
  ({ economy: 'none', label: 'Thing', origin: 'Test', ...extra }) as SheetAction;

const DICE = resource('superiority-dice', 'Superiority Dice', 4, { die: '1d10' });
const AMBUSH = action({
  label: 'Maneuvers: Ambush',
  origin: 'Maneuvers: Ambush',
  cost: { resource: 'superiority-dice', amount: 1 },
});
const GENIUS = action({ label: 'Flash of Genius', origin: 'Flash of Genius', economy: 'reaction' });
const GENIUS_USES = resource('flash-of-genius', 'Flash of Genius', 3, {
  origin: 'Flash of Genius',
});

const play = (
  used: Record<string, number> = {},
  reaction = false,
): Pick<PlayState, 'resources' | 'turn'> => ({
  resources: Object.entries(used).map(([key, n]) => ({ key, used: n })),
  turn: { action: false, bonus: false, reaction },
});

describe('offerPrice', () => {
  const battleMaster = { actions: [AMBUSH], resources: [DICE] };

  it('prices an extra as its own action’s Use, with the paying pool’s die', () => {
    expect(offerPrice(battleMaster, play(), 'Maneuvers: Ambush')).toEqual({
      pay: {
        spends: [{ key: 'superiority-dice', max: 4, amount: 1 }],
        reaction: false,
        words: 'spends 1 Superiority Dice',
      },
      die: '1d10',
    });
  });

  it('finds the paying action by its origin when it carries another name', () => {
    const named = { ...battleMaster, actions: [{ ...AMBUSH, label: 'Ambush' }] };
    expect(offerPrice(named, play(), 'Maneuvers: Ambush')?.pay.words).toBe(
      'spends 1 Superiority Dice',
    );
  });

  it('finds the paying action by its name when it comes from the species', () => {
    const footwork = action({ label: 'Lucky Footwork', origin: 'Harengon', economy: 'reaction' });
    const sheet = {
      actions: [footwork],
      resources: [resource('a', 'A', 1, { origin: 'Lucky Footwork' })],
    };
    expect(offerPrice(sheet, play(), 'Lucky Footwork')?.pay).toEqual({
      spends: [],
      reaction: true,
      words: 'marks your reaction',
    });
  });

  it('prefers the action from it that costs something over one that does not', () => {
    const free = action({ origin: 'Maneuvers: Ambush', label: 'Hide', economy: 'bonus' });
    const sheet = { actions: [free, { ...AMBUSH, label: 'Ambush' }], resources: [DICE] };
    expect(offerPrice(sheet, play(), 'Maneuvers: Ambush')?.pay.spends).toHaveLength(1);
  });

  it('takes the reaction and a use when the action is a reaction', () => {
    const sheet = { actions: [GENIUS], resources: [GENIUS_USES] };
    expect(offerPrice(sheet, play(), 'Flash of Genius')?.pay).toEqual({
      spends: [{ key: 'flash-of-genius', max: 3, amount: 1 }],
      reaction: true,
      words: 'marks your reaction and spends a Flash of Genius use',
    });
  });

  it('pays from the pool named for the feature, or the one pool it gives, with no action', () => {
    const kenku = { actions: [], resources: [resource('kenku-recall', 'Kenku Recall', 2)] };
    expect(offerPrice(kenku, play(), 'Kenku Recall')?.pay.words).toBe('spends a Kenku Recall use');
    const lucky = {
      actions: [],
      resources: [resource('luck-points', 'Luck Points', 2, { origin: 'Lucky' })],
    };
    expect(offerPrice(lucky, play(), 'Lucky')?.pay.spends).toEqual([
      { key: 'luck-points', max: 2, amount: 1 },
    ]);
    const two = {
      actions: [],
      resources: [
        resource('a', 'A', 1, { origin: 'Lucky' }),
        resource('b', 'B', 1, { origin: 'Lucky' }),
      ],
    };
    expect(offerPrice(two, play(), 'Lucky')).toBeUndefined();
  });

  it('takes the reaction alone for a row that says so, with nothing else to pay', () => {
    const none = { actions: [], resources: [] };
    expect(offerPrice(none, play(), 'Arcane Deflection', true)?.pay).toEqual({
      spends: [],
      reaction: true,
      words: 'marks your reaction',
    });
    expect(offerPrice(none, play(), 'Arcane Deflection')).toBeUndefined();
  });

  it('never takes the reaction for a row that says not to', () => {
    const cd = resource('channel-divinity', 'Channel Divinity', 2);
    const guided = action({
      label: 'Guided Strike',
      origin: 'Guided Strike',
      economy: 'reaction',
      cost: { resource: 'channel-divinity', amount: 1 },
    });
    const price = offerPrice(
      { actions: [guided], resources: [cd] },
      play({}, true),
      'Guided Strike',
      false,
    );
    expect(price?.pay).toEqual({
      spends: [{ key: 'channel-divinity', max: 2, amount: 1 }],
      reaction: false,
      words: 'spends 1 Channel Divinity',
    });
  });

  it('offers nothing the character cannot pay now', () => {
    expect(offerPrice(battleMaster, play({ 'superiority-dice': 4 }), 'Maneuvers: Ambush')).toBe(
      undefined,
    );
    const genius = { actions: [GENIUS], resources: [GENIUS_USES] };
    expect(offerPrice(genius, play({}, true), 'Flash of Genius')).toBeUndefined();
  });

  it('offers nothing it finds no price for, or that costs only an action', () => {
    expect(offerPrice(battleMaster, play(), 'Unknown')).toBeUndefined();
    const surge = action({ label: 'Surge', origin: 'Surge', economy: 'bonus' });
    expect(offerPrice({ actions: [surge], resources: [] }, play(), 'Surge')).toBeUndefined();
  });
});

describe('pricedRollEffects', () => {
  const base: RollEffects = {
    dice: [],
    offers: [{ dice: '1d4', source: 'Guidance', once: true, ifFailed: false }],
    advantage: [],
    disadvantage: [],
  };
  const sheet = {
    actions: [AMBUSH, GENIUS],
    resources: [DICE, GENIUS_USES, resource('luck-points', 'Luck Points', 3, { origin: 'Lucky' })],
  };

  it('leaves riders with nothing paid as they are', () => {
    expect(pricedRollEffects(base, sheet, play())).toBe(base);
  });

  it('drops what is paid with no play state to pay from', () => {
    const riders = { ...base, paid: [{ source: 'Maneuvers: Ambush', poolDie: true }] };
    expect(pricedRollEffects(riders, sheet, undefined)).toEqual(base);
  });

  it('offers the pool’s die after what was offered, priced', () => {
    const riders = { ...base, paid: [{ source: 'Maneuvers: Ambush', poolDie: true }] };
    expect(pricedRollEffects(riders, sheet, play()).offers).toEqual([
      base.offers[0],
      {
        dice: '1d10',
        source: 'Maneuvers: Ambush',
        once: true,
        ifFailed: false,
        pay: {
          spends: [{ key: 'superiority-dice', max: 4, amount: 1 }],
          reaction: false,
          words: 'spends 1 Superiority Dice',
        },
      },
    ]);
  });

  it('offers a bonus as a die of its size, only once the d20 shows, with its flags', () => {
    const riders = {
      ...base,
      paid: [
        {
          source: 'Flash of Genius',
          bonus: 3,
          after: true,
          ifFailed: true,
          reaction: true,
          when: 'Only when it fails',
        },
      ],
    };
    expect(pricedRollEffects(riders, sheet, play()).offers[1]).toMatchObject({
      dice: '3',
      after: true,
      ifFailed: true,
      when: 'Only when it fails',
      pay: { reaction: true },
    });
  });

  it('carries a use kept on a failure', () => {
    const riders = {
      ...base,
      paid: [{ source: 'Maneuvers: Ambush', dice: '1d10', ifFailed: true, spentOnSuccess: true }],
    };
    expect(pricedRollEffects(riders, sheet, play()).offers[1]).toMatchObject({
      dice: '1d10',
      ifFailed: true,
      spentOnSuccess: true,
    });
  });

  it('offers a bonus only once the d20 shows, though its row does not say so', () => {
    const riders = { ...base, paid: [{ source: 'Flash of Genius', bonus: 2 }] };
    expect(pricedRollEffects(riders, sheet, play()).offers[1]).toMatchObject({
      dice: '2',
      after: true,
    });
  });

  it('offers no bonus of nothing', () => {
    const riders = { ...base, paid: [{ source: 'Flash of Genius', bonus: 0, after: true }] };
    expect(pricedRollEffects(riders, sheet, play()).offers).toEqual(base.offers);
  });

  it('turns paid advantage into a claim that carries its price', () => {
    const riders = { ...base, paid: [{ source: 'Lucky', advantage: true }] };
    expect(pricedRollEffects(riders, sheet, play()).declare).toEqual([
      {
        source: 'Lucky',
        mode: 'adv',
        when: '',
        pay: {
          spends: [{ key: 'luck-points', max: 3, amount: 1 }],
          reaction: false,
          words: 'spends a Luck Points use',
        },
      },
    ]);
  });

  it('drops what the character cannot pay, and keeps the rest', () => {
    const riders = {
      ...base,
      paid: [
        { source: 'Maneuvers: Ambush', poolDie: true },
        { source: 'Lucky', advantage: true },
      ],
    };
    const priced = pricedRollEffects(riders, sheet, play({ 'superiority-dice': 4 }));
    expect(priced.offers).toEqual(base.offers);
    expect(priced.declare?.map((d) => d.source)).toEqual(['Lucky']);
    expect(priced.paid).toBeUndefined();
  });

  describe('rerolls', () => {
    const INDOMITABLE = resource('indomitable', 'Indomitable', 1, {
      origin: 'Indomitable',
      resetOn: 'long',
    });
    // Living Legend's own action spends its use: a reroll in it takes the reaction alone.
    const LEGEND = action({
      label: 'Living Legend',
      origin: 'Living Legend',
      economy: 'bonus',
      cost: { resource: 'living-legend', amount: 1 },
    });
    const withRerolls = {
      actions: [LEGEND],
      resources: [INDOMITABLE, resource('living-legend', 'Living Legend', 1)],
    };
    const luck = { source: 'Luck', die: 'one' as const, atMost: 1, auto: true, free: true };
    const indomitable = { source: 'Indomitable', ifFailed: true, bonus: 13 };
    const legend = { source: 'Living Legend', free: true, reaction: true, ifFailed: true };
    const focus = { source: 'Fanatical Focus', free: true, ifFailed: true, when: 'Once a Rage' };
    const riders = (rerolls: RollEffects['rerolls']) => ({ ...base, rerolls });

    it('keeps a reroll made as the d20 lands, with no play state too', () => {
      expect(pricedRollEffects(riders([luck]), withRerolls, undefined)).toEqual({
        ...base,
        rerolls: [luck],
      });
      const priced = pricedRollEffects(riders([luck]), withRerolls, play());
      expect(priced.rerolls).toEqual([luck]);
      expect(priced.rerollOffers).toBeUndefined();
    });

    it('rolls in only what rerolls as the d20 lands, and offers the rest after', () => {
      const both = riders([luck, indomitable]);
      expect(pricedRollEffects(both, withRerolls, undefined).rerolls).toEqual([luck]);
      const priced = pricedRollEffects(both, withRerolls, play());
      expect(priced.rerolls).toEqual([luck]);
      expect(priced.rerollOffers?.map((o) => o.source)).toEqual(['Indomitable']);
      expect(pricedRollEffects(riders([indomitable]), withRerolls, play()).rerolls).toBeUndefined();
    });

    it('offers a paid reroll priced as its Use, with its bonus and flags', () => {
      expect(pricedRollEffects(riders([indomitable]), withRerolls, play()).rerollOffers).toEqual([
        {
          source: 'Indomitable',
          die: 'all',
          ifFailed: true,
          bonus: 13,
          pay: {
            spends: [{ key: 'indomitable', max: 1, amount: 1 }],
            reaction: false,
            words: 'spends an Indomitable use',
          },
        },
      ]);
    });

    it('offers no paid reroll the character cannot pay, or with no play state', () => {
      expect(
        pricedRollEffects(riders([indomitable]), withRerolls, play({ indomitable: 1 }))
          .rerollOffers,
      ).toBeUndefined();
      expect(pricedRollEffects(riders([indomitable]), withRerolls, undefined)).toEqual(base);
    });

    it('offers a free reroll at no price, saying when it holds', () => {
      expect(pricedRollEffects(riders([focus]), withRerolls, play()).rerollOffers).toEqual([
        { source: 'Fanatical Focus', die: 'all', ifFailed: true, when: 'Once a Rage' },
      ]);
    });

    it("prices one that takes the reaction alone without the feature's own use", () => {
      expect(
        pricedRollEffects(riders([legend]), withRerolls, play()).rerollOffers?.[0]?.pay,
      ).toEqual({ spends: [], reaction: true, words: 'marks your reaction' });
      expect(
        pricedRollEffects(riders([legend]), withRerolls, play({}, true)).rerollOffers,
      ).toBeUndefined();
    });

    it('offers no reroll of the lower die after the roll: that one rolls on its own', () => {
      const low = { source: 'Elven Accuracy', die: 'low' as const, free: true };
      expect(pricedRollEffects(riders([low]), withRerolls, play()).rerollOffers).toBeUndefined();
    });

    it('carries which die a reroll takes and the most it may show', () => {
      const twins = { source: 'Khenra Twins', die: 'one' as const, atMost: 1, free: true };
      expect(pricedRollEffects(riders([twins]), withRerolls, play()).rerollOffers).toEqual([
        { source: 'Khenra Twins', die: 'one', atMost: 1, ifFailed: false },
      ]);
    });
  });
});

describe('paying for an extra, and giving it back', () => {
  const pay = {
    spends: [{ key: 'superiority-dice', max: 4, amount: 1 }],
    reaction: true,
    words: 'marks your reaction and spends 1 Superiority Dice',
  };
  const fresh = (used?: number, reaction = false): PlayState =>
    ({
      resources: used === undefined ? [] : [{ key: 'superiority-dice', used }],
      turn: { action: false, bonus: false, reaction },
    }) as unknown as PlayState;

  it('spends the uses and marks the reaction', () => {
    const p = fresh();
    expect(payOffer(p, pay)).toBe(true);
    expect(p.resources).toEqual([{ key: 'superiority-dice', used: 1 }]);
    expect(p.turn?.reaction).toBe(true);
    const q = fresh(2);
    expect(payOffer(q, pay)).toBe(true);
    expect(q.resources).toEqual([{ key: 'superiority-dice', used: 3 }]);
  });

  it('pays nothing at all when a use or the reaction is gone', () => {
    const empty = fresh(4);
    expect(payOffer(empty, pay)).toBe(false);
    expect(empty.resources).toEqual([{ key: 'superiority-dice', used: 4 }]);
    expect(empty.turn?.reaction).toBe(false);
    const reacted = fresh(0, true);
    expect(payOffer(reacted, pay)).toBe(false);
    expect(reacted.resources).toEqual([{ key: 'superiority-dice', used: 0 }]);
  });

  it('gives back the uses and the reaction, never below none', () => {
    const p = fresh();
    payOffer(p, pay);
    refundOffer(p, pay);
    expect(p.resources).toEqual([{ key: 'superiority-dice', used: 0 }]);
    expect(p.turn?.reaction).toBe(false);
    refundOffer(p, pay);
    expect(p.resources).toEqual([{ key: 'superiority-dice', used: 0 }]);
  });

  it('leaves the reaction alone for an extra that did not take it', () => {
    const p = fresh(1, true);
    refundOffer(p, { ...pay, reaction: false });
    expect(p.turn?.reaction).toBe(true);
    expect(p.resources).toEqual([{ key: 'superiority-dice', used: 0 }]);
  });
});
