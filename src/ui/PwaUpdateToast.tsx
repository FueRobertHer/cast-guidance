import { useRegisterSW } from 'virtual:pwa-register/react';
import { swStatusStore } from '@/stores/swStatus';

/**
 * Shows when a new app version is waiting. It also owns the app's only
 * service worker registration, so it reports what that registration learns
 * to `swStatus` for the offline-readiness line and notice.
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

  if (!needRefresh) return null;
  return (
    <div className="fixed inset-x-4 top-3 z-50 flex items-center justify-between gap-3 rounded-lg border border-surface-2 bg-surface/95 px-4 py-2.5 shadow-lg backdrop-blur lg:left-auto lg:right-6 lg:w-96">
      <span className="text-sm">A new version of the app is ready.</span>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => void updateServiceWorker(true)}
          className="rounded bg-accent px-3 py-1 text-sm font-semibold text-white"
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
