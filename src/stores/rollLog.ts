import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { RollResult } from '@/dice/types';

const MAX_LOG = 100;

export interface RollLogState {
  rolls: RollResult[];
  append(result: RollResult): void;
  clear(): void;
}

export const rollLogStore = createStore<RollLogState>((set) => ({
  rolls: [],
  append: (result) => set((s) => ({ rolls: [result, ...s.rolls].slice(0, MAX_LOG) })),
  clear: () => set({ rolls: [] }),
}));

export function useRollLog<T>(selector: (s: RollLogState) => T): T {
  return useStore(rollLogStore, selector);
}
