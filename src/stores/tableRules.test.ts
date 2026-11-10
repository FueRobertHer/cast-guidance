// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { engineContextFor } from '@/data5e/engineAdapter';
import type { EntityRegistry } from '@/data5e/normalize';
import { ONE_USE_DICE_KEY, oneUseDiceSetting, setOneUseDice } from '@/lib/oneUseDice';
import { appTableRules, setAppTableRule, useAppTableRules } from './tableRules';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  window.dispatchEvent(new StorageEvent('storage', { key: null }));
});

describe("the app's table rules", () => {
  it('are none chosen to start, so every rule plays as written', () => {
    expect(appTableRules()).toEqual({});
  });

  it('keep each choice under its own key, and take it back to as written', () => {
    setAppTableRule('critDamage', 'maxPlusRoll');
    setAppTableRule('restLength', 'gritty');
    expect(appTableRules()).toEqual({ critDamage: 'maxPlusRoll', restLength: 'gritty' });
    expect(localStorage.getItem('cast-guidance:table-rule:critDamage')).toBe('maxPlusRoll');
    setAppTableRule('critDamage', undefined);
    expect(appTableRules()).toEqual({ restLength: 'gritty' });
    expect(localStorage.getItem('cast-guidance:table-rule:critDamage')).toBeNull();
  });

  it('give the same object while nothing changes, for useSyncExternalStore', () => {
    setAppTableRule('flanking', 'plusTwo');
    expect(appTableRules()).toBe(appTableRules());
  });

  it('read a value they do not know (an older or newer one) as no choice', () => {
    localStorage.setItem('cast-guidance:table-rule:hpOnLongRest', 'quarter');
    expect(appTableRules()).toEqual({});
  });

  it('keep one-use dice under the key it always had, so its setting carries over', () => {
    localStorage.setItem(ONE_USE_DICE_KEY, 'before');
    expect(appTableRules()).toEqual({ oneUseDice: 'before' });
    expect(oneUseDiceSetting()).toBe('before');
    // As written, chosen, is stored as made, so it outranks an app-default pack.
    setOneUseDice('after');
    expect(localStorage.getItem(ONE_USE_DICE_KEY)).toBe('after');
    expect(appTableRules()).toEqual({ oneUseDice: 'after' });
    setAppTableRule('oneUseDice', undefined);
    expect(localStorage.getItem(ONE_USE_DICE_KEY)).toBeNull();
    expect(appTableRules()).toEqual({});
  });

  it('keep a choice storage refused until the tab closes', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    setAppTableRule('hpEachLevel', 'max');
    expect(appTableRules()).toEqual({ hpEachLevel: 'max' });
    // Stored once storage takes it again, which lets go of the one kept in the tab.
    vi.restoreAllMocks();
    setAppTableRule('hpEachLevel', undefined);
    expect(appTableRules()).toEqual({});
  });

  it('re-render their readers when changed here or in another tab', () => {
    const { result } = renderHook(() => useAppTableRules());
    expect(result.current).toEqual({});
    act(() => setAppTableRule('restLength', 'heroic'));
    expect(result.current).toEqual({ restLength: 'heroic' });
    localStorage.setItem('cast-guidance:table-rule:restLength', 'gritty');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'cast-guidance:table-rule:restLength' }),
      );
    });
    expect(result.current).toEqual({ restLength: 'gritty' });
  });

  it('reach the engine through the context the registry is wrapped in', () => {
    const registry = { get: () => undefined, byType: () => [] } as unknown as EntityRegistry;
    setAppTableRule('critDamage', 'doubleTotal');
    expect(engineContextFor(registry).rules).toEqual({ critDamage: 'doubleTotal' });
    expect(engineContextFor(registry, { flanking: 'advantage' }).rules).toEqual({
      flanking: 'advantage',
    });
  });
});
