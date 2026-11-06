import { describe, expect, it } from 'vitest';
import type { DerivedResource, DerivedSheet } from '@/engine/types';
import { actionUse } from './actionUse';

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

  it('says no uses are left when that pool is empty', () => {
    const u = use(action(), [OWN], { own: 2 });
    expect(u.disabled).toBe(true);
    expect(u.title).toBe('No uses left');
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
