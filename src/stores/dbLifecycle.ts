import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * Whether this tab still holds the app's database (TEST-002).
 *
 * - `open`: the normal case. A connection the browser dropped on its own (the
 *   Safari kill case) still counts as open, because the next write reopens it.
 * - `deleted`: another tab deleted the database ("Reset app data"). This tab
 *   has closed its connection for good, so a pending save cannot recreate the
 *   database and write its character back into the reset device.
 * - `superseded`: another tab opened a newer schema. This tab closed so that
 *   upgrade could go ahead, and stays closed so older code never writes into
 *   tables shaped for the newer version.
 *
 * Both closed states end only with a reload.
 */
export type DbLifecycle = 'open' | 'deleted' | 'superseded';

export interface DbLifecycleState {
  state: DbLifecycle;
  markClosed(state: Exclude<DbLifecycle, 'open'>): void;
}

/** Vanilla store: the handler that feeds it lives with the database, outside React. */
export const dbLifecycleStore = createStore<DbLifecycleState>((set) => ({
  state: 'open',
  markClosed: (state) => set({ state }),
}));

export function useDbLifecycle<T>(selector: (s: DbLifecycleState) => T): T {
  return useStore(dbLifecycleStore, selector);
}
