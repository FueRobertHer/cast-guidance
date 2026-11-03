import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { announce } from '@/stores/announcer';
import { swStatusStore } from '@/stores/swStatus';
import { Banner, BannerAction, BannerDismiss } from './Banner';

/** What the offer says, on screen and to a screen reader. */
export const PWA_UPDATE_TEXT = 'A new version of the app is ready.';

/**
 * Shows when a new app version is waiting. It also owns the app's only
 * service worker registration, so it reports what that registration learns
 * to `swStatus` for the offline-readiness line and notice.
 *
 * A `guide` banner (DS-001), like the data update offer: in the page, never
 * over the screen title.
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
    <Banner
      tone="guide"
      icon={RefreshCw}
      actions={
        <>
          <BannerAction tone="guide" onClick={() => void updateServiceWorker(true)}>
            Update
          </BannerAction>
          <BannerDismiss tone="guide" label="Later" onClick={() => setNeedRefresh(false)} />
        </>
      }
    >
      {PWA_UPDATE_TEXT}
    </Banner>
  );
}
