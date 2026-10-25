import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * Whether this tab still holds the app's database (TEST-002).
 *
 * - `open`: the normal case. A connection the browser dropped on its own (the
 *   Safari kill case, or the back/forward cache) still counts as open, because
 *   the next write reopens it.
 * - `deleted`: the database was deleted under this tab, by another tab's
 *   "Reset app data" or by the browser clearing the site's storage. This tab
 *   has closed its connection for good, so a pending save cannot recreate the
 *   database and write its character back into the reset device.
 * - `superseded`: another tab opened a newer schema. This tab closed so that
 *   upgrade could go ahead, and stays closed so older code never writes into
 *   tables shaped for the newer version.
 * - `stale`: this tab's very first open found a newer schema than it knows,
 *   so this copy of the app is the old one (stale HTML, or a deploy rolled
 *   back below a schema bump). It never writes, for the same reason.
 *
 * Both closed states end only with a reload.
 */
export type DbLifecycle = 'open' | 'deleted' | 'superseded' | 'stale';

export interface DbLifecycleState {
  state: DbLifecycle;
  /**
   * The id stamped into the database this tab first opened. A reopen that
   * finds a different one, or has to create the database, is looking at a
   * database that was deleted under this tab. Undefined until the first
   * open; null once opened while no stamp has been written (a full device),
   * so the next open adopts whatever id it finds instead of calling it a delete.
   */
  instanceId?: string | null;
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
