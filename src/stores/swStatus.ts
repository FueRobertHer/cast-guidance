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
