import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { RollResult } from '@/dice/types';

const MAX_LOG = 100;

export interface RollLogState {
  rolls: RollResult[];
  /** Monotonic counter — toast trigger even when totals repeat. */
  seq: number;
  append(result: RollResult): void;
  /** Remove one entry (accidental clicks) by its assigned `id`. */
  remove(id: string): void;
  clear(): void;
}

export const rollLogStore = createStore<RollLogState>((set) => ({
  rolls: [],
  seq: 0,
  append: (result) =>
    set((s) => ({
      // Stamp a collision-proof id so same-millisecond rolls stay distinct.
      rolls: [{ ...result, id: result.id ?? crypto.randomUUID() }, ...s.rolls].slice(0, MAX_LOG),
      seq: s.seq + 1,
    })),
  remove: (id) => set((s) => ({ rolls: s.rolls.filter((r) => r.id !== id) })),
  clear: () => set({ rolls: [] }),
}));

export function useRollLog<T>(selector: (s: RollLogState) => T): T {
  return useStore(rollLogStore, selector);
}
