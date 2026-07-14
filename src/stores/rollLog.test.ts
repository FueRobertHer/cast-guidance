import { describe, expect, it } from 'vitest';
import type { RollResult } from '@/dice/types';
import { rollLogStore } from './rollLog';

function roll(at: number, total = 1): RollResult {
  return { expr: '1d20', total, at, terms: [] };
}

describe('rollLogStore', () => {
  it('assigns a distinct id even when two rolls share a timestamp', () => {
    rollLogStore.getState().clear();
    rollLogStore.getState().append(roll(1000));
    rollLogStore.getState().append(roll(1000));
    const ids = rollLogStore.getState().rolls.map((r) => r.id);
    expect(ids.every((id) => typeof id === 'string')).toBe(true);
    expect(new Set(ids).size).toBe(2); // no collision despite identical `at`
  });

  it('removes only the targeted roll by id, not same-timestamp siblings', () => {
    rollLogStore.getState().clear();
    rollLogStore.getState().append(roll(2000));
    rollLogStore.getState().append(roll(2000));
    const [first] = rollLogStore.getState().rolls;
    rollLogStore.getState().remove(first?.id ?? '');
    const remaining = rollLogStore.getState().rolls;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).not.toBe(first?.id);
  });
});
