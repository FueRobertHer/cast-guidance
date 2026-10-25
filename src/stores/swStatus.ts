import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * Whether the service worker has the app shell cached, so the app itself can
 * open without a connection. The game data is a separate question
 * (`dataStatus`); "safe to use offline" needs both.
 */
export type SwState = 'pending' | 'ready' | 'error';

export interface SwStatusState {
  state: SwState;
  markReady(): void;
  markError(): void;
}

/**
 * Fed by the one `useRegisterSW` call in `PwaUpdateToast`. Registering a
 * second time to ask the same question would register twice, so everything
 * else reads this instead.
 */
export const swStatusStore = createStore<SwStatusState>((set) => ({
  state: 'pending',
  markReady: () => set({ state: 'ready' }),
  // Ready is final for this page: a failed update check does not uncache the
  // shell that is already installed.
  markError: () => set((s) => (s.state === 'ready' ? s : { state: 'error' })),
}));

export function useSwStatus<T>(selector: (s: SwStatusState) => T): T {
  return useStore(swStatusStore, selector);
}

/**
 * Whether this page can have a service worker at all. Dev builds never
 * register one, so they answer no, the same as a browser without the API.
 * Read at call time rather than import time so tests can flip `DEV` with
 * `vi.stubEnv`.
 */
export function serviceWorkerSupported(): boolean {
  return !import.meta.env.DEV && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

export type ShellReadiness = 'unsupported' | SwState;

export function shellReadiness(s: SwStatusState): ShellReadiness {
  return serviceWorkerSupported() ? s.state : 'unsupported';
}

/**
 * Whether this tab was loaded through the worker. Without `clientsClaim` (the
 * prompt-to-update flow needs it off) the first visit stays uncontrolled even
 * after the install finishes, so a lazy route chunk fetched later in that tab
 * still goes to the network. Guarded because reading `navigator.serviceWorker`
 * throws a SecurityError in Firefox when site storage is blocked.
 */
export function pageControlled(): boolean {
  try {
    return 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null;
  } catch {
    return false;
  }
}

/**
 * - `now`: opens with no connection, in this tab as well.
 * - `next-launch`: everything is cached, but this tab was not loaded through
 *   the worker, so it works offline after a reload or the next time the app opens.
 * - `no`: the shell or the compendium is not there yet.
 */
export type OfflineReadiness = 'now' | 'next-launch' | 'no';

/**
 * Here rather than beside the card's hooks so the shell's offline notice can
 * use it without pulling those hooks into the entry chunk.
 */
export function offlineReadiness(
  shell: ShellReadiness | 'checking' | 'stalled',
  compendiumComplete: boolean,
  controlled: boolean,
): OfflineReadiness {
  if (shell !== 'ready' || !compendiumComplete) return 'no';
  return controlled ? 'now' : 'next-launch';
}
