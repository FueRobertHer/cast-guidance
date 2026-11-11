import { describe, expect, it } from 'vitest';
import { type DerivedResource, type DerivedSheet, HIT_DIE_COST, SLOT_COST } from '@/engine/types';
import { actionUse, applyRestore } from './actionUse';

type SheetAction = DerivedSheet['actions'][number];

const resource = (key: string, label: string, max: number): DerivedResource => ({
  key,
  label,
  max,
  resetOn: 'long',
  origin: 'Test',
});
const POOL = resource('pool', 'Test Pool (d6)', 5);
const OWN = resource('own', 'Quick Step', 2);

const action = (extra: Partial<SheetAction> = {}): SheetAction =>
  ({ economy: 'bonus', label: 'Quick Step', origin: 'Test', ...extra }) as SheetAction;

const use = (a: SheetAction, resources: DerivedResource[], used: Record<string, number> = {}) =>
  actionUse(a, resources, (key) => used[key] ?? 0);

describe('actionUse', () => {
  it('spends a use of the pool sharing its name when it names no cost', () => {
    const u = use(action(), [OWN], { own: 1 });
    expect(u.spends).toEqual([{ key: 'own', max: 2, amount: 1 }]);
    expect(u.caption).toEqual(['1 of 2 left']);
    expect(u.title).toBe('Use: marks your bonus action and spends a Quick Step use');
    expect(u.disabled).toBe(false);
  });

  it('says "an" before a pool name that starts with a vowel', () => {
    const u = use(action({ label: 'Aberrant Dragonmark' }), [
      resource('own', 'Aberrant Dragonmark', 1),
    ]);
    expect(u.title).toBe('Use: marks your bonus action and spends an Aberrant Dragonmark use');
  });

  it('says no uses are left when that pool is empty', () => {
    const u = use(action(), [OWN], { own: 2 });
    expect(u.disabled).toBe(true);
    expect(u.title).toBe('No uses left');
  });

  it('reads uses past the maximum as none left, as after losing a level', () => {
    const u = use(action(), [OWN], { own: 3 });
    expect(u.disabled).toBe(true);
    expect(u.caption).toEqual(['0 of 2 left']);
    const paying = use(action({ cost: { resource: 'pool', amount: 1 } }), [POOL], { pool: 6 });
    expect(paying.disabled).toBe(true);
    expect(paying.caption).toEqual(['Test Pool: 1, 0 of 5 left']);
  });

  it('marks the turn and nothing else with no pool at all', () => {
    const u = use(action(), []);
    expect(u.spends).toEqual([]);
    expect(u.caption).toEqual([]);
    expect(u.title).toBe('Use: marks your bonus action');
  });

  it('spends the amount a cost names, and captions the pool without its die size', () => {
    const u = use(action({ cost: { resource: 'pool', amount: 2 } }), [POOL], { pool: 1 });
    expect(u.spends).toEqual([{ key: 'pool', max: 5, amount: 2 }]);
    expect(u.caption).toEqual(['Test Pool: 2, 4 of 5 left']);
    expect(u.title).toBe('Use: marks your bonus action and spends 2 Test Pool');
    expect(u.noButton).toBe(false);
  });

  it('will not spend what the pool does not have', () => {
    const u = use(action({ cost: { resource: 'pool', amount: 2 } }), [POOL], { pool: 4 });
    expect(u.disabled).toBe(true);
    expect(u.title).toBe('Not enough Test Pool');
  });

  it('spends both when the cost says it takes a use of the feature too', () => {
    const cost = { resource: 'pool', amount: 3, ownUseToo: true };
    const u = use(action({ cost }), [OWN, POOL]);
    expect(u.spends).toEqual([
      { key: 'own', max: 2, amount: 1 },
      { key: 'pool', max: 5, amount: 3 },
    ]);
    expect(u.caption).toEqual(['2 of 2 left', 'Test Pool: 3, 5 of 5 left']);
    expect(use(action({ cost }), [OWN, POOL], { own: 2 }).title).toBe('No uses left');
  });

  it('leaves a pool sharing its name alone when it has a cost of its own', () => {
    const u = use(action({ cost: { resource: 'pool', amount: 3 } }), [OWN, POOL], { own: 2 });
    expect(u.spends).toEqual([{ key: 'pool', max: 5, amount: 3 }]);
    expect(u.caption).toEqual(['Test Pool: 3, 5 of 5 left']);
    expect(u.disabled).toBe(false);
  });

  it('spends no use of the pool sharing its name when another chip of the feature does', () => {
    const u = use(action({ spendsNoUse: true }), [OWN], { own: 2 });
    expect(u.spends).toEqual([]);
    expect(u.caption).toEqual([]);
    expect(u.disabled).toBe(false);
    expect(u.title).toBe('Use: marks your bonus action');
  });

  it('pays once when the cost names the pool sharing its name', () => {
    const u = use(action({ cost: { resource: 'own', amount: 2 } }), [OWN]);
    expect(u.spends).toEqual([{ key: 'own', max: 2, amount: 2 }]);
  });

  it('spends nothing by itself when the player decides how much', () => {
    const u = use(action({ cost: { resource: 'pool', amount: 'varies' } }), [POOL]);
    expect(u.spends).toEqual([]);
    expect(u.caption).toEqual(['Test Pool: you choose, 5 of 5 left']);
    expect(u.title).toBe('Use: marks your bonus action');
    expect(u.noButton).toBe(false);
    expect(u.paid).toBeUndefined();
  });

  it('has no button when it takes no slot and the player decides how much', () => {
    const u = use(action({ economy: 'none', cost: { resource: 'pool', amount: 'varies' } }), [
      POOL,
    ]);
    expect(u.noButton).toBe(true);
  });

  it('spends without marking anything for a rider', () => {
    const u = use(action({ economy: 'none', cost: { resource: 'pool', amount: 1 } }), [POOL]);
    expect(u.title).toBe('Use: spends 1 Test Pool');
    expect(u.noButton).toBe(false);
  });

  it('offers a free use and a paid one when the base use is free', () => {
    const u = use(action({ cost: { resource: 'pool', amount: 1, optional: true } }), [POOL]);
    expect(u.spends).toEqual([]);
    expect(u.disabled).toBe(false);
    expect(u.caption).toEqual(['Test Pool: 1 for more, 5 of 5 left']);
    expect(u.paid).toEqual({
      label: '+1 Test Pool',
      ariaLabel: 'Use Quick Step, spending 1 Test Pool',
      spends: [{ key: 'pool', max: 5, amount: 1 }],
      disabled: false,
      title: 'Use: marks your bonus action and spends 1 Test Pool',
    });
  });

  it('keeps the free use when the pool cannot pay for more', () => {
    const u = use(action({ cost: { resource: 'pool', amount: 1, optional: true } }), [POOL], {
      pool: 5,
    });
    expect(u.disabled).toBe(false);
    expect(u.paid?.disabled).toBe(true);
    expect(u.paid?.title).toBe('Not enough Test Pool');
  });
});

describe('a buy-back', () => {
  const buyBack = { resource: 'pool', amount: 2 };

  it('says the price while uses are left, with no button', () => {
    const u = use(action({ buyBack }), [OWN, POOL], { pool: 1 });
    expect(u.spends).toEqual([{ key: 'own', max: 2, amount: 1 }]);
    expect(u.caption).toEqual(['2 of 2 left', 'Test Pool: 2 to restore, 4 of 5 left']);
    expect(u.restore).toBeUndefined();
  });

  it('never spends the pool on Use', () => {
    const u = use(action({ buyBack }), [OWN, POOL], { own: 1 });
    expect(u.spends).toEqual([{ key: 'own', max: 2, amount: 1 }]);
    expect(u.disabled).toBe(false);
  });

  it('offers the button at no uses left, with Use still out of reach', () => {
    const u = use(action({ buyBack }), [OWN, POOL], { own: 2 });
    expect(u.disabled).toBe(true);
    expect(u.restore).toEqual({
      label: 'Quick Step',
      own: { key: 'own', max: 2 },
      spend: { key: 'pool', max: 5, amount: 2 },
      ariaLabel: 'Restore Quick Step, spending 2 Test Pool',
      disabled: false,
      title: 'Restore: spends 2 Test Pool for one more use',
    });
  });

  it('disables the button when the pool is short', () => {
    const u = use(action({ buyBack }), [OWN, POOL], { own: 2, pool: 4 });
    expect(u.restore?.disabled).toBe(true);
    expect(u.restore?.title).toBe('Not enough Test Pool');
  });

  it('names the use when it sits on another row, and leaves Use alone', () => {
    const spell = resource('spell-key', 'Far Reach', 1);
    const a = action({ buyBack: { ...buyBack, own: 'spell-key' } });
    const left = use(a, [spell, POOL]);
    expect(left.caption).toEqual(['Test Pool: 2 to restore Far Reach, 5 of 5 left']);
    expect(left.spends).toEqual([]);
    expect(left.restore).toBeUndefined();

    const none = use(a, [spell, POOL], { 'spell-key': 1 });
    expect(none.disabled).toBe(false);
    expect(none.restore?.own).toEqual({ key: 'spell-key', max: 1 });
    expect(none.restore?.label).toBe('Far Reach');
  });

  it('keeps a cost and a buy-back apart on one action', () => {
    const a = action({ cost: { resource: 'other', amount: 1 }, buyBack });
    const other = resource('other', 'Other', 3);
    const u = use(a, [OWN, POOL, other], { own: 2 });
    expect(u.spends).toEqual([{ key: 'other', max: 3, amount: 1 }]);
    expect(u.caption).toEqual(['Other: 1, 3 of 3 left', 'Test Pool: 2 to restore, 5 of 5 left']);
    expect(u.restore?.spend?.key).toBe('pool');
  });

  it('shows nothing when the use or the pool is missing', () => {
    expect(use(action({ buyBack }), [OWN]).restore).toBeUndefined();
    expect(use(action({ buyBack }), [OWN]).caption).toEqual(['2 of 2 left']);
    expect(use(action({ buyBack: { ...buyBack, own: 'gone' } }), [POOL]).caption).toEqual([]);
  });
});

describe('an action that refills a pool', () => {
  const regains = { resource: 'pool', amount: 1 };

  it('says what it refills, and gives it back on top of spending its use', () => {
    const u = use(action({ regains }), [OWN, POOL], { pool: 2 });
    expect(u.spends).toEqual([{ key: 'own', max: 2, amount: 1 }]);
    expect(u.regains).toEqual({ key: 'pool', max: 5, amount: 1 });
    expect(u.caption).toEqual(['2 of 2 left', 'Test Pool: regains 1, 3 of 5 left']);
    expect(u.disabled).toBe(false);
    expect(u.title).toBe(
      'Use: marks your bonus action and spends a Quick Step use and regains 1 Test Pool',
    );
  });

  it('is off with nothing to refill, so a tap cannot waste the use', () => {
    const u = use(action({ regains }), [OWN, POOL]);
    expect(u.disabled).toBe(true);
    expect(u.title).toBe('No Test Pool to regain');
  });

  it('says no uses are left before anything else', () => {
    const u = use(action({ regains }), [OWN, POOL], { own: 2, pool: 2 });
    expect(u.disabled).toBe(true);
    expect(u.title).toBe('No uses left');
  });

  it('adds nothing when the pool is not on the sheet', () => {
    const u = use(action({ regains }), [OWN]);
    expect(u.regains).toBeUndefined();
    expect(u.disabled).toBe(false);
    expect(u.caption).toEqual(['2 of 2 left']);
  });
});

describe('applyRestore', () => {
  const restore = use(action({ buyBack: { resource: 'pool', amount: 2 } }), [OWN, POOL], {
    own: 2,
  }).restore;
  if (restore === undefined) throw new Error('no restore');

  it('takes the price and gives one use back', () => {
    const entries = [{ key: 'own', used: 2 }];
    applyRestore(entries, restore);
    expect(entries).toEqual([
      { key: 'own', used: 1 },
      { key: 'pool', used: 2 },
    ]);
  });

  it('adds to what the pool has already spent', () => {
    const entries = [
      { key: 'own', used: 2 },
      { key: 'pool', used: 3 },
    ];
    applyRestore(entries, restore);
    expect(entries).toEqual([
      { key: 'own', used: 1 },
      { key: 'pool', used: 5 },
    ]);
  });

  it('brings a count past the maximum back to one use left', () => {
    const entries = [{ key: 'own', used: 5 }];
    applyRestore(entries, restore);
    expect(entries[0]).toEqual({ key: 'own', used: 1 });
  });

  it('takes nothing when the pool no longer has the price', () => {
    const entries = [
      { key: 'own', used: 2 },
      { key: 'pool', used: 4 },
    ];
    applyRestore(entries, restore);
    expect(entries).toEqual([
      { key: 'own', used: 2 },
      { key: 'pool', used: 4 },
    ]);
  });

  it('takes nothing when a use is already back', () => {
    const entries = [{ key: 'own', used: 1 }];
    applyRestore(entries, restore);
    expect(entries).toEqual([{ key: 'own', used: 1 }]);
    const none: { key: string; used: number }[] = [];
    applyRestore(none, restore);
    expect(none).toEqual([]);
  });
});

describe('a cost or buy-back paid with a spell slot or Hit Point Die', () => {
  const paying = (slots: number, dice = 0) => ({ slotsLeft: () => slots, hitDiceLeft: dice });
  const paid = (
    a: SheetAction,
    resources: DerivedResource[],
    pay: ReturnType<typeof paying>,
    used: Record<string, number> = {},
  ) => actionUse(a, resources, (key) => used[key] ?? 0, pay);
  const slot = { resource: SLOT_COST, amount: 1 } as const;

  it('leaves the slot to the prompt, spending only the turn and the uses itself', () => {
    const u = paid(action({ cost: slot, economy: 'reaction' }), [], paying(3));
    expect(u.slot).toEqual(slot);
    expect(u.spends).toEqual([]);
    expect(u.disabled).toBe(false);
    expect(u.title).toBe('Use: marks your reaction and spends a spell slot');
    expect(u.caption).toEqual(['Spell slots: 3 left']);
  });

  it('spends a use as well when the cost says so', () => {
    const u = paid(action({ cost: { ...slot, ownUseToo: true } }), [OWN], paying(3), { own: 1 });
    expect(u.spends).toEqual([{ key: 'own', max: 2, amount: 1 }]);
    expect(u.caption).toEqual(['1 of 2 left', 'Spell slots: 3 left']);
  });

  it('is off with no slot of the level it takes', () => {
    const u = paid(action({ cost: { ...slot, minLevel: 5 } }), [], paying(0));
    expect(u.disabled).toBe(true);
    expect(u.title).toBe('None left to pay: it takes a level 5+ spell slot');
    expect(u.caption).toEqual(['Spell slots: level 5+: 0 left']);
  });

  it('says what a slot turns into, and is off with none of it spent', () => {
    const points = resource('sorcery-points', 'Sorcery Points', 5);
    const a = action({ cost: { ...slot, slotRefills: 'sorcery-points' }, economy: 'none' });
    const u = paid(a, [points], paying(2), { 'sorcery-points': 3 });
    expect(u.disabled).toBe(false);
    expect(u.caption).toEqual([
      'Spell slots: 2 left',
      "Sorcery Points: regains the slot's level, 2 of 5 left",
    ]);
    const full = paid(a, [points], paying(2));
    expect(full.disabled).toBe(true);
    expect(full.title).toBe('No Sorcery Points to regain');
  });

  it('pays a Hit Point Die the same way', () => {
    const die = { resource: HIT_DIE_COST, amount: 1, hitDieHeals: 'roll' } as const;
    const u = paid(action({ cost: die }), [], paying(0, 4));
    expect(u.hitDie).toEqual(die);
    expect(u.slot).toBeUndefined();
    expect(u.title).toBe('Use: marks your bonus action and spends a Hit Point Die');
    expect(u.caption).toEqual(['Hit Point Dice: 4 left']);
    expect(paid(action({ cost: die }), [], paying(0, 0)).disabled).toBe(true);
  });

  it('restores a use with a slot once none are left, naming the slot it takes', () => {
    const a = action({ buyBack: { resource: SLOT_COST, amount: 1, minLevel: 5 } });
    const left = paid(a, [OWN], paying(1));
    expect(left.caption).toEqual(['2 of 2 left', 'Spell slots: level 5+ to restore, 1 left']);
    expect(left.restore).toBeUndefined();
    const none = paid(a, [OWN], paying(1), { own: 2 });
    expect(none.restore).toEqual({
      label: 'Quick Step',
      own: { key: 'own', max: 2 },
      slot: { minLevel: 5 },
      ariaLabel: 'Restore Quick Step, spending a level 5+ spell slot',
      disabled: false,
      title: 'Restore: spends a level 5+ spell slot for one more use',
    });
    expect(paid(a, [OWN], paying(0), { own: 2 }).restore?.disabled).toBe(true);
  });

  it("restores another pool's use, naming it", () => {
    const wild = resource('wild-shape', 'Wild Shape', 2);
    const a = action({ buyBack: { resource: SLOT_COST, amount: 1, own: 'wild-shape' } });
    const u = paid(a, [wild], paying(2), { 'wild-shape': 2 });
    expect(u.caption).toEqual(['Spell slots to restore Wild Shape, 2 left']);
    expect(u.restore?.own).toEqual({ key: 'wild-shape', max: 2 });
  });

  it('gives the use back and leaves the slot to the caller', () => {
    const restore = paid(
      action({ buyBack: { resource: SLOT_COST, amount: 1 } }),
      [OWN],
      paying(1),
      { own: 2 },
    ).restore;
    if (restore === undefined) throw new Error('no restore');
    const entries = [{ key: 'own', used: 2 }];
    expect(applyRestore(entries, restore)).toBe(true);
    expect(entries).toEqual([{ key: 'own', used: 1 }]);
    expect(applyRestore(entries, restore)).toBe(false);
  });
});
