import { createStore } from 'zustand/vanilla';

/**
 * How the roll toast spends a die it offers (Guidance, Bardic Inspiration)
 * without importing sheet code: the open sheet sets `spend`, which ends the
 * effect when its die is added and puts it back when the die is taken off.
 * `expired` counts the moments offers stop waiting (the hit points changed),
 * so the toast lets them go. `before` is the open character's house rule: its
 * one-use dice are named before the roll (`lib/oneUseDice`, `stores/heldRoll`).
 */
export interface RollOffersState {
  spend: ((effectId: string, taken: boolean) => void) | null;
  expired: number;
  before: boolean;
  setSpend(spend: ((effectId: string, taken: boolean) => void) | null): void;
  expire(): void;
  setBefore(before: boolean): void;
}

export const rollOffersStore = createStore<RollOffersState>((set) => ({
  spend: null,
  expired: 0,
  before: false,
  setSpend: (spend) => set({ spend }),
  expire: () => set((s) => ({ expired: s.expired + 1 })),
  setBefore: (before) => set({ before }),
}));
