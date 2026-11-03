import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** The dice tray's two views (DS-001 DiceTray): the dice, and every roll. */
export type DiceTrayView = 'roll' | 'history';

export interface DiceTrayState {
  open: boolean;
  view: DiceTrayView;
  /**
   * How many trays are mounted. The roll toast opens the tray on a tap, so it
   * is a button only while there is one to open (on the sheet's pages).
   */
  mounted: number;
  /**
   * Where focus goes when a tray opened from somewhere other than its own
   * button closes, if that is still on the page: the roll toast is gone by
   * then, so it records what had focus before it was pressed.
   */
  returnTo: HTMLElement | null;
  show(view: DiceTrayView, returnTo?: HTMLElement | null): void;
  setOpen(open: boolean): void;
  setView(view: DiceTrayView): void;
  /** Counts a tray in; returns the function that counts it out. */
  mount(): () => void;
}

/**
 * Its own small module, apart from the tray, because the roll toast is in the
 * entry bundle: anything it imports from the lazy sheet code would pull that
 * code into the entry (see rollTone.ts).
 */
export const diceTrayStore = createStore<DiceTrayState>((set) => ({
  open: false,
  view: 'roll',
  mounted: 0,
  returnTo: null,
  show: (view, returnTo = null) => set({ open: true, view, returnTo }),
  // Opened from its own button: on the dice, and focus goes back to that
  // button, as a sheet's does.
  setOpen: (open) => set(open ? { open, view: 'roll', returnTo: null } : { open }),
  setView: (view) => set({ view }),
  mount: () => {
    set((s) => ({ mounted: s.mounted + 1 }));
    // Leaving the sheet with the tray open must not open it on the way back.
    return () =>
      set((s) => ({
        mounted: s.mounted - 1,
        ...(s.mounted === 1 ? { open: false, returnTo: null } : {}),
      }));
  },
}));

export function useDiceTray<T>(selector: (s: DiceTrayState) => T): T {
  return useStore(diceTrayStore, selector);
}
