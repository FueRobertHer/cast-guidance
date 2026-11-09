import { createStore } from 'zustand/vanilla';

/**
 * How the roll toast spends a die it offers (Guidance, Bardic Inspiration)
 * without importing sheet code: the open sheet sets `spend`, which ends the
 * effect when its die is added and puts it back when the die is taken off.
 * `expired` counts the moments offers stop waiting (the hit points changed),
 * so the toast lets them go.
 */
export interface RollOffersState {
  spend: ((effectId: string, taken: boolean) => void) | null;
  expired: number;
  setSpend(spend: ((effectId: string, taken: boolean) => void) | null): void;
  expire(): void;
}

export const rollOffersStore = createStore<RollOffersState>((set) => ({
  spend: null,
  expired: 0,
  setSpend: (spend) => set({ spend }),
  expire: () => set((s) => ({ expired: s.expired + 1 })),
}));
