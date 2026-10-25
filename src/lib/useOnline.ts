import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/**
 * What the browser reports about the network, kept current. Only `false` is
 * taken at its word: `onLine` true means a network interface is up, not that
 * a server can be reached, so a failure while "online" is still a failure.
 */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * Whether the device says it is online, re-rendering when that changes. For
 * choosing what to say about a failed download: "you're offline" is the
 * reason and the remedy at once, where the fetch error under it is neither.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true);
}
