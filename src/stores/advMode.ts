import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export type AdvMode = 'normal' | 'adv' | 'dis';

export interface AdvModeState {
  mode: AdvMode;
  set(mode: AdvMode): void;
}

/**
 * Global advantage/disadvantage. Sticky until changed — every d20 roll
 * (checks, saves, attacks, initiative, quick dice) honors it.
 */
export const advModeStore = createStore<AdvModeState>((set) => ({
  mode: 'normal',
  set: (mode) => set({ mode }),
}));

export function useAdvMode<T>(selector: (s: AdvModeState) => T): T {
  return useStore(advModeStore, selector);
}

/** Roll-options fragment for the current mode. */
export function currentAdvantage(): 'adv' | 'dis' | undefined {
  const m = advModeStore.getState().mode;
  return m === 'normal' ? undefined : m;
}
