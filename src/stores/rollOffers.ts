import { createStore } from 'zustand/vanilla';
import type { RollOffer } from '@/dice/types';

/**
 * A feature's own extra the prompt pays for: the offer, or the claim, carrying
 * its price. One with no price pays nothing.
 */
export interface PaidExtra {
  source: string;
  pay?: RollOffer['pay'];
}

/**
 * How the roll toast spends a die it offers (Guidance, Bardic Inspiration)
 * without importing sheet code: the open sheet sets `spend`, which ends the
 * effect when its die is added and puts it back when the die is taken off,
 * and `pay`, which pays for a feature's own extra (Precision Attack's die,
 * 2024 Lucky's advantage) as its Use is paid and gives it back when it is
 * taken off. Each takes the very object it paid for back, so paying twice or
 * giving back what was never paid does nothing. An extra goes on a roll only
 * once `pay` says it is paid: with no sheet open, or nothing left to pay
 * with, it stays off.
 * `expired` counts the moments offers stop waiting (the hit points changed),
 * so the toast lets them go. `before` is the open character's house rule: its
 * one-use dice are named before the roll (`lib/oneUseDice`, `stores/heldRoll`).
 */
export interface RollOffersState {
  spend: ((effectId: string, taken: boolean) => void) | null;
  /** Pays for an extra (`taken`) or gives it back; says whether it is paid or given back. */
  pay: ((extra: PaidExtra, taken: boolean) => boolean) | null;
  expired: number;
  before: boolean;
  setSpend(spend: ((effectId: string, taken: boolean) => void) | null): void;
  setPay(pay: ((extra: PaidExtra, taken: boolean) => boolean) | null): void;
  expire(): void;
  setBefore(before: boolean): void;
}

export const rollOffersStore = createStore<RollOffersState>((set) => ({
  spend: null,
  pay: null,
  expired: 0,
  before: false,
  setSpend: (spend) => set({ spend }),
  setPay: (pay) => set({ pay }),
  expire: () => set((s) => ({ expired: s.expired + 1 })),
  setBefore: (before) => set({ before }),
}));
