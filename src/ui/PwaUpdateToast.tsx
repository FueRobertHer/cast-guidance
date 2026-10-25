import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEffect } from 'react';
import { announce } from '@/stores/announcer';
import { swStatusStore } from '@/stores/swStatus';

/** What the offer says, on screen and to a screen reader. */
export const PWA_UPDATE_TEXT = 'A new version of the app is ready.';

/**
 * Shows when a new app version is waiting. It also owns the app's only
 * service worker registration, so it reports what that registration learns
 * to `swStatus` for the offline-readiness line and notice.
 *
 * A plain visual: a region that mounts with its text is announced unreliably,
 * so the offer is said through the announcer (A11Y-002), once each time a new
 * version starts waiting, under the key it shares with the data update offer.
 */
export function PwaUpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // A warm boot never fires `onOfflineReady`: the worker installed on an
    // earlier visit, so an active one in the registration is the answer.
    onRegisteredSW: (_url, registration) => {
      if (registration?.active) swStatusStore.getState().markReady();
    },
    // The first install finishing, which is when the shell is cached.
    onOfflineReady: () => swStatusStore.getState().markReady(),
    onRegisterError: () => swStatusStore.getState().markError(),
  });

  useEffect(() => {
    if (needRefresh) announce(PWA_UPDATE_TEXT, { key: 'update' });
  }, [needRefresh]);

  if (!needRefresh) return null;
  return (
    <div className="fixed inset-x-4 top-3 z-50 flex items-center justify-between gap-3 rounded-lg border border-surface-2 bg-surface/95 px-4 py-2.5 shadow-lg backdrop-blur lg:left-auto lg:right-6 lg:w-96">
      <span className="text-sm">{PWA_UPDATE_TEXT}</span>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => void updateServiceWorker(true)}
          className="rounded bg-accent-fill px-3 py-1 text-sm font-semibold text-white"
        >
          Update
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="rounded bg-surface-2 px-3 py-1 text-sm"
        >
          Later
        </button>
      </div>
    </div>
  );
}
